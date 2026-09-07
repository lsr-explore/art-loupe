/**
 * Injection screening for untrusted text (FR-106, FR-505, FR-803).
 *
 * Five surfaces carry text this system did not write: a filename, the EXIF block inside an
 * uploaded photograph, whatever is legible in the pixels, the artist's own free-text goal, and
 * the documents retrieval brings back. All five are **data**. Screening records what arrived on
 * each of them and never acts on it — nothing in slice 1 branches on a detection, and the point
 * of saying so here is that a future reader looking for the enforcement will not find one and
 * should not add one without deciding, deliberately, what enforcement would mean.
 *
 * The goal is on that list not because the artist is untrusted but because the field is where
 * pasted text arrives, and it reaches a model prompt in PR 12. `intent.ts` already committed to
 * screening it "on the same footing as EXIF and filename". FR-1013 still holds: an artist
 * assertion is intent, never evidence.
 *
 * The rules themselves live in `../fixtures/screening-rules.json` rather than in this file.
 * That is the whole design: `python/libs/schemas/src/artloupe/schemas/screening.py` is a
 * hand-authored mirror of this module, and the way the two are kept honest is that neither
 * one owns the rules. Both load the same file, and both run the same case corpus out of it —
 * so a rule that behaves differently under two regex engines fails in the suite that did not
 * change. It is the same arrangement `contract-parity.json` already makes for Zod and
 * Pydantic, for the same reason.
 *
 * Why this lives in `@artloupe/schemas` rather than in the studio app: the retrieved-document
 * surface is screened Python-side, and the filename and EXIF surfaces are screened by a Next
 * route handler. A screener that lived in either place would be reimplemented in the other.
 */

import rulesDocument from '../fixtures/screening-rules.json';

/** The closed set of surfaces that carry text nobody in this system wrote. */
export const SCREENED_SURFACES = [
  'filename',
  'exif',
  'ocr',
  'project-goal',
  'retrieved-document',
] as const;

export type ScreenedSurface = (typeof SCREENED_SURFACES)[number];

/**
 * How loud a detection is. Ranking only — see the fixture's `$severity` note.
 *
 * Nothing reads this to decide behaviour, because nothing decides behaviour from a detection
 * at all. It orders the operations panel so the interesting rows are not below the fold.
 */
export type DetectionSeverity = 'high' | 'medium';

/** One rule firing on one surface. */
export interface Detection {
  surface: ScreenedSurface;
  /** Rule id from the shared fixture, e.g. `instruction-override`. */
  ruleId: string;
  severity: DetectionSeverity;
  /**
   * A bounded window of the text that matched — stored so a human can see what arrived.
   *
   * Bounded rather than whole because the source may be a retrieved document of any length,
   * and an unbounded excerpt would make the detections table the second copy of it.
   */
  excerpt: string;
}

interface ScreeningRule {
  id: string;
  severity: DetectionSeverity;
  patterns: string[];
}

interface RulesDocument {
  surfaces: string[];
  rules: ScreeningRule[];
}

/** Longest excerpt kept for a match, in characters. */
export const EXCERPT_MAX_LENGTH = 160;

/** Characters of context kept on each side of a match, budget permitting. */
const EXCERPT_CONTEXT = 24;

const document = rulesDocument as unknown as RulesDocument;

/**
 * Compiled once at module load.
 *
 * `i` and `m` on every pattern, matching the Python mirror's `IGNORECASE | MULTILINE`. The
 * `m` matters more than it looks: several rules anchor with `^` to stay quiet on ordinary
 * prose — `system:` at the start of a line is a turn marker, mid-sentence it is an artist
 * describing a subject — and without `m` that anchor would only ever see the first line.
 *
 * Not global (`g`). A global regex carries `lastIndex` between calls, so a shared compiled
 * instance would skip matches on every other invocation. Each rule reports at most once per
 * value anyway, so there is nothing a global flag would buy.
 */
const COMPILED_RULES: { rule: ScreeningRule; expressions: RegExp[] }[] = document.rules.map(
  (rule) => ({
    rule,
    expressions: rule.patterns.map((pattern) => new RegExp(pattern, 'im')),
  }),
);

/**
 * Trim a match down to a readable window.
 *
 * Whitespace is collapsed first. Hostile text arrives with newlines and padding in it
 * deliberately, and an excerpt that preserved them would wrap a log line into a screenful.
 */
const excerptAround = (value: string, matchIndex: number, matchLength: number): string => {
  const start = Math.max(0, matchIndex - EXCERPT_CONTEXT);
  const end = Math.min(value.length, matchIndex + matchLength + EXCERPT_CONTEXT);
  const window = value.slice(start, end).replace(/\s+/gu, ' ').trim();

  if (window.length <= EXCERPT_MAX_LENGTH) {
    return window;
  }
  return `${window.slice(0, EXCERPT_MAX_LENGTH - 1)}…`;
};

/**
 * Screen one string.
 *
 * At most one detection per rule, even when a rule matches several times: the excerpt is
 * there to show a human what kind of thing arrived, and ten excerpts of the same rule from
 * one poisoned document is noise rather than ten times the evidence.
 */
export const screenText = (surface: ScreenedSurface, value: string): Detection[] => {
  if (value.length === 0) {
    return [];
  }

  const detections: Detection[] = [];

  for (const { rule, expressions } of COMPILED_RULES) {
    for (const expression of expressions) {
      const match = expression.exec(value);
      if (match === null) {
        continue;
      }
      detections.push({
        surface,
        ruleId: rule.id,
        severity: rule.severity,
        excerpt: excerptAround(value, match.index, match[0].length),
      });
      break;
    }
  }

  return detections;
};

/**
 * Screen every string reachable inside a decoded EXIF block or a retrieved document.
 *
 * Walks rather than stringifying the whole structure. `JSON.stringify` would have been one
 * line, and it would have introduced two bugs: the quoting and bracing it inserts can create
 * or destroy a match at a value boundary, and the excerpt would then point at a location in
 * a serialization the artist never sent.
 *
 * Keys are walked as well as values. XMP and IPTC let the writer name their own properties,
 * so a key is no more trustworthy than the thing it labels.
 */
export const screenValues = (surface: ScreenedSurface, value: unknown): Detection[] => {
  const seenRules = new Set<string>();
  const detections: Detection[] = [];

  const visit = (node: unknown, depth: number): void => {
    // Bounded because EXIF is attacker-supplied structure, not only attacker-supplied text:
    // a deeply nested maker note would otherwise recurse until the stack gave out.
    if (depth > 8) {
      return;
    }

    if (typeof node === 'string') {
      for (const detection of screenText(surface, node)) {
        if (seenRules.has(detection.ruleId)) {
          continue;
        }
        seenRules.add(detection.ruleId);
        detections.push(detection);
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry, depth + 1);
      }
      return;
    }

    if (node !== null && typeof node === 'object') {
      for (const [key, entry] of Object.entries(node as Record<string, unknown>)) {
        visit(key, depth + 1);
        visit(entry, depth + 1);
      }
    }
  };

  visit(value, 0);
  return detections;
};
