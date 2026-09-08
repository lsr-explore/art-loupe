'use client';

/**
 * The intake form — one photograph and five fields (FR-101, FR-102).
 *
 * This is the browser half of `POST /api/projects`. The handler's own correctness is covered
 * by its unit suite and by a live end-to-end run; what is decided *here* is everything the
 * handler cannot see: whether the request is assembled correctly, whether each refusal reason
 * becomes a sentence an artist can act on, and whether the error surface is reachable by
 * keyboard and announced.
 *
 * ## Where validation lives, and where it deliberately does not
 *
 * The server is the boundary. Every rule that matters — the accepted formats, the 25 MB cap,
 * the 800 px minimum, the shape of `ProjectIntent` — is enforced there, from the bytes, and
 * this component's job on a refusal is to *render the reason*, not to pre-empt it.
 *
 * Two client-side checks exist anyway, and both are about the round trip rather than about
 * correctness:
 *
 * - **Size**, because `route.ts` refuses an over-sized body *as it streams* and cancels the
 *   reader. The artist would otherwise push 40 MB up a domestic uplink to be told no, and the
 *   cancelled request can surface as a transport failure rather than as the 422 that explains
 *   itself. `MAX_UPLOAD_BYTES` is imported, never restated.
 * - **The intent fields**, because a malformed intent comes back as the single opaque reason
 *   `invalid_intent` — the reason vocabulary is closed on purpose, so a Zod message cannot
 *   leak through it. Telling the artist *which* field is wrong has to happen on this side or
 *   nowhere.
 *
 * **The file's declared type is deliberately not checked here.** `inspect-image.ts` sniffs the
 * format from the bytes and never consults the client's claim, so a browser that reports an
 * empty or wrong `File.type` — which happens, particularly on Linux and on some Android
 * pickers — would be refused locally for a photograph the server accepts. `accept` narrows the
 * file picker, which is a hint; the sniff is the answer.
 *
 * ## The error surface
 *
 * A summary region at the top of the form, focused on failure, with one entry per problem
 * linking to the field it belongs to — plus the message repeated beside the field and
 * `aria-invalid` on the control. That is the GOV.UK error-summary pattern, and both halves are
 * needed: the summary is what a screen-reader user hears after submitting, and the inline copy
 * is what a sighted user finds after following the link. Whole-request failures (an expired
 * session, a duplicate, the service being down) appear in the summary with no link, because
 * there is no field to send anyone to.
 */

import { Button } from '@artloupe/fascia/components/ui/button';
import { Input } from '@artloupe/fascia/components/ui/input';
import { Label } from '@artloupe/fascia/components/ui/label';
import { Select } from '@artloupe/fascia/components/ui/select';
import { Textarea } from '@artloupe/fascia/components/ui/textarea';
// The values and limits come from the zod-free subpaths, never from the package barrel: the
// barrel re-exports the schemas, `intent.ts` imports `zod` at module scope, and pulling seven
// medium names through it put ~98 kB of validator into the client bundle. `ProjectIntent` is a
// type-only import and is erased. See `packages/schemas/src/intent-values.ts` for the numbers.
import type { ProjectIntent } from '@artloupe/schemas';
import {
  ACCEPTED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  MIN_LONG_EDGE_PX,
} from '@artloupe/schemas/image-limits';
import { MEDIA, type Medium, SKILL_LEVELS, type SkillLevel } from '@artloupe/schemas/intent-values';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import {
  type CreateProjectResponse,
  FILE_FIELD,
  INTENT_FIELD,
  PROJECTS_ENDPOINT,
  type UploadRejection,
} from '@/lib/api/project-contract';

/** FR-102: the goal is free text and the schema caps it. Kept in step with `intent.ts`. */
const MAX_GOAL_LENGTH = 2000;

/** Field ids, shared between the labels, the `aria-describedby` wiring and the summary links. */
const FIELD = {
  file: 'intake-file',
  medium: 'intake-medium',
  time: 'intake-time',
  supportWidth: 'intake-support-width',
  supportHeight: 'intake-support-height',
  supportUnits: 'intake-support-units',
  skill: 'intake-skill',
  goal: 'intake-goal',
} as const;

type FieldId = (typeof FIELD)[keyof typeof FIELD];

interface IntakeError {
  /** Message key under the `intake.errors` namespace. */
  key: string;
  /** The field this belongs to. Absent when the failure is about the request as a whole. */
  fieldId?: FieldId;
}

/**
 * Server refusal reasons mapped to catalog keys.
 *
 * A `Record` over the closed union rather than a lookup with a fallback: widening
 * `UploadRejection` then fails to compile here, which is the only place that would otherwise
 * quietly render a reason code at an artist.
 */
const REJECTION_MESSAGE: Record<UploadRejection, { key: string; fieldId?: FieldId }> = {
  missing_file: { key: 'missingFile', fieldId: FIELD.file },
  too_large: { key: 'tooLarge', fieldId: FIELD.file },
  unsupported_type: { key: 'unsupportedType', fieldId: FIELD.file },
  undecodable: { key: 'undecodable', fieldId: FIELD.file },
  below_min_dimension: { key: 'belowMinDimension', fieldId: FIELD.file },
  // No field link. The client validates every intent field before submitting, so reaching this
  // means the two sides disagree about the contract rather than that the artist mistyped —
  // pointing at a field would send them to correct something that already looks right.
  invalid_intent: { key: 'invalidIntent' },
};

/** Read a form field as trimmed text. `FormData` yields `File | string | null`. */
const textField = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

/** A positive integer, or `null` for anything else — including `''`, `1.5`, `-3` and `1e3`. */
const positiveInteger = (raw: string): number | null => {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

/** A positive finite number, or `null`. Support dimensions are measurements, not counts. */
const positiveNumber = (raw: string): number | null => {
  const parsed = Number(raw);
  return raw !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

interface ValidatedIntent {
  intent: ProjectIntent;
  file: File;
}

type Validation = { ok: true; value: ValidatedIntent } | { ok: false; errors: IntakeError[] };

/**
 * Turn the submitted form into a `ProjectIntent`, or into the list of things wrong with it.
 *
 * Every problem is collected rather than returning at the first, so the summary lists all of
 * them at once — a form that reveals one error per submit makes an artist with five empty
 * fields submit five times.
 *
 * The photograph arrives as an argument rather than being pulled back out of the `FormData`,
 * because `FormData.get` is typed `File | string | null` and a file input always yields *a*
 * `File` — an empty, nameless one when nothing is chosen. Taking it from the input's own
 * `files` list is both typed and unambiguous.
 */
const validate = (form: FormData, chosen: File | null): Validation => {
  const errors: IntakeError[] = [];

  const photograph = chosen !== null && chosen.size > 0 ? chosen : null;
  if (photograph === null) {
    errors.push({ key: 'missingFile', fieldId: FIELD.file });
  } else if (photograph.size > MAX_UPLOAD_BYTES) {
    errors.push({ key: 'tooLarge', fieldId: FIELD.file });
  }

  const rawMedium = textField(form, 'medium');
  const medium = (MEDIA as readonly string[]).includes(rawMedium) ? (rawMedium as Medium) : null;
  if (medium === null) {
    errors.push({ key: 'missingMedium', fieldId: FIELD.medium });
  }

  const timeBudgetMinutes = positiveInteger(textField(form, 'time_budget_minutes'));
  if (timeBudgetMinutes === null) {
    errors.push({ key: 'invalidTime', fieldId: FIELD.time });
  }

  const rawSkill = textField(form, 'skill_level');
  const skillLevel = (SKILL_LEVELS as readonly string[]).includes(rawSkill)
    ? (rawSkill as SkillLevel)
    : 'intermediate';

  // Support is optional as a *pair* (FR-102: "the rest have defaults"). Blank means the artist
  // did not say, which is `null` — half-filled means they started and stopped, which is a
  // mistake worth naming rather than silently rounding to "did not say".
  const rawWidth = textField(form, 'support_width');
  const rawHeight = textField(form, 'support_height');
  const rawUnits = textField(form, 'support_units');
  const width = positiveNumber(rawWidth);
  const height = positiveNumber(rawHeight);
  let support: ProjectIntent['support'] = null;

  if (rawWidth !== '' || rawHeight !== '') {
    if (width === null) {
      errors.push({ key: 'invalidSupport', fieldId: FIELD.supportWidth });
    }
    if (height === null) {
      errors.push({ key: 'invalidSupport', fieldId: FIELD.supportHeight });
    }
    if (width !== null && height !== null) {
      support = { width, height, units: rawUnits === 'mm' ? 'mm' : 'in' };
    }
  }

  const rawGoal = textField(form, 'goal');
  if (rawGoal.length > MAX_GOAL_LENGTH) {
    errors.push({ key: 'goalTooLong', fieldId: FIELD.goal });
  }

  if (errors.length > 0 || photograph === null || medium === null || timeBudgetMinutes === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      file: photograph,
      intent: {
        medium,
        time_budget_minutes: timeBudgetMinutes,
        support,
        skill_level: skillLevel,
        // UNTRUSTED (FR-106). Sent verbatim for the server to screen; this side neither
        // interprets it nor sanitizes it, because sanitizing here would hide from the screener
        // exactly the text it exists to record.
        goal: rawGoal === '' ? null : rawGoal,
      },
    },
  };
};

/** Whole-request failures, by status. Anything unrecognised falls through to `unavailable`. */
const STATUS_MESSAGE: Record<number, string> = {
  401: 'sessionExpired',
  404: 'unavailable',
  409: 'duplicate',
  502: 'unavailable',
};

export const IntakeForm = () => {
  const ti = useTranslations('intake');
  const router = useRouter();
  const [errors, setErrors] = useState<IntakeError[]>([]);
  const [failures, setFailures] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const photographRef = useRef<HTMLInputElement>(null);

  /**
   * Focus lands on the summary, not on the first bad field: the artist hears how many things
   * are wrong before being dropped into one of them, and the links are then the way in.
   *
   * Driven by a counter rather than by the error list, because two consecutive submissions can
   * fail identically — press the button twice with the same empty form and the list is
   * unchanged, so keying the effect on the errors would move focus once and then stop
   * responding. The counter also runs the effect after the commit, which is when the region
   * exists to receive focus at all.
   */
  useEffect(() => {
    if (failures > 0) {
      summaryRef.current?.focus();
    }
  }, [failures]);

  const fail = (next: IntakeError[]) => {
    setErrors(next);
    setFailures((count) => count + 1);
  };

  const errorFor = (fieldId: FieldId): IntakeError | undefined =>
    errors.find((entry) => entry.fieldId === fieldId);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const form = new FormData(event.currentTarget);
    const validated = validate(form, photographRef.current?.files?.[0] ?? null);
    if (!validated.ok) {
      fail(validated.errors);
      return;
    }

    setErrors([]);
    setSubmitting(true);

    const body = new FormData();
    body.set(FILE_FIELD, validated.value.file);
    body.set(INTENT_FIELD, JSON.stringify(validated.value.intent));

    let response: Response;
    try {
      response = await fetch(PROJECTS_ENDPOINT, { method: 'POST', body });
    } catch {
      setSubmitting(false);
      fail([{ key: 'network' }]);
      return;
    }

    if (response.status === 201) {
      const created = (await response.json()) as CreateProjectResponse;
      // `submitting` stays true through the navigation, so the button cannot be pressed twice
      // while the next route loads and a second project cannot be created by an impatient click.
      router.push(`/projects/${created.projectId}`);
      return;
    }

    setSubmitting(false);

    if (response.status === 422) {
      const refusal = (await response.json().catch(() => null)) as { reason?: string } | null;
      const known =
        refusal?.reason !== undefined
          ? REJECTION_MESSAGE[refusal.reason as UploadRejection]
          : undefined;
      fail([known ?? { key: 'unavailable' }]);
      return;
    }

    fail([{ key: STATUS_MESSAGE[response.status] ?? 'unavailable' }]);
  };

  const describedBy = (fieldId: FieldId, ...hints: string[]): string => {
    const parts = [...hints];
    if (errorFor(fieldId)) {
      parts.push(`${fieldId}-error`);
    }
    return parts.join(' ');
  };

  const fieldError = (fieldId: FieldId) => {
    const entry = errorFor(fieldId);
    return entry ? (
      <p id={`${fieldId}-error`} className="text-sm text-destructive">
        {ti(`errors.${entry.key}`, {
          limitMb: MAX_UPLOAD_BYTES / 1024 / 1024,
          minPx: MIN_LONG_EDGE_PX,
        })}
      </p>
    ) : null;
  };

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-6">
      {errors.length > 0 ? (
        <div
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
          aria-labelledby="intake-error-summary-title"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <h2 id="intake-error-summary-title" className="text-sm font-medium text-destructive">
            {ti('errorSummaryTitle')}
          </h2>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-destructive">
            {errors.map((entry) => {
              const message = ti(`errors.${entry.key}`, {
                limitMb: MAX_UPLOAD_BYTES / 1024 / 1024,
                minPx: MIN_LONG_EDGE_PX,
              });
              return (
                <li key={`${entry.key}-${entry.fieldId ?? 'request'}`}>
                  {entry.fieldId ? (
                    <a className="underline underline-offset-2" href={`#${entry.fieldId}`}>
                      {message}
                    </a>
                  ) : (
                    message
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={FIELD.file}>{ti('fileLabel')}</Label>
        <p id="intake-file-hint" className="text-sm text-muted-foreground">
          {ti('fileHint', { limitMb: MAX_UPLOAD_BYTES / 1024 / 1024, minPx: MIN_LONG_EDGE_PX })}
        </p>
        <Input
          ref={photographRef}
          id={FIELD.file}
          name={FILE_FIELD}
          type="file"
          // A hint to the picker, never a check. The format is decided from the bytes.
          accept={ACCEPTED_MIME_TYPES.join(',')}
          className="h-auto py-1.5"
          aria-describedby={describedBy(FIELD.file, 'intake-file-hint')}
          aria-invalid={errorFor(FIELD.file) !== undefined}
        />
        {fieldError(FIELD.file)}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={FIELD.medium}>{ti('mediumLabel')}</Label>
        <Select
          id={FIELD.medium}
          name="medium"
          defaultValue=""
          aria-describedby={describedBy(FIELD.medium)}
          aria-invalid={errorFor(FIELD.medium) !== undefined}
        >
          <option value="" disabled>
            {ti('mediumPlaceholder')}
          </option>
          {MEDIA.map((medium) => (
            <option key={medium} value={medium}>
              {ti(`media.${medium}`)}
            </option>
          ))}
        </Select>
        {fieldError(FIELD.medium)}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={FIELD.time}>{ti('timeLabel')}</Label>
        <p id="intake-time-hint" className="text-sm text-muted-foreground">
          {ti('timeHint')}
        </p>
        <Input
          id={FIELD.time}
          name="time_budget_minutes"
          type="number"
          inputMode="numeric"
          min={1}
          step={15}
          className="max-w-40"
          aria-describedby={describedBy(FIELD.time, 'intake-time-hint')}
          aria-invalid={errorFor(FIELD.time) !== undefined}
        />
        {fieldError(FIELD.time)}
      </div>

      <fieldset className="flex flex-col gap-1.5 border-0 p-0">
        <legend className="text-sm font-medium">{ti('supportLegend')}</legend>
        <p id="intake-support-hint" className="text-sm text-muted-foreground">
          {ti('supportHint')}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={FIELD.supportWidth}>{ti('supportWidthLabel')}</Label>
            <Input
              id={FIELD.supportWidth}
              name="support_width"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className="w-28"
              aria-describedby={describedBy(FIELD.supportWidth, 'intake-support-hint')}
              aria-invalid={errorFor(FIELD.supportWidth) !== undefined}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={FIELD.supportHeight}>{ti('supportHeightLabel')}</Label>
            <Input
              id={FIELD.supportHeight}
              name="support_height"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className="w-28"
              aria-describedby={describedBy(FIELD.supportHeight, 'intake-support-hint')}
              aria-invalid={errorFor(FIELD.supportHeight) !== undefined}
            />
          </div>
          <div className="flex w-32 flex-col gap-1.5">
            <Label htmlFor={FIELD.supportUnits}>{ti('supportUnitsLabel')}</Label>
            <Select id={FIELD.supportUnits} name="support_units" defaultValue="in">
              <option value="in">{ti('units.in')}</option>
              <option value="mm">{ti('units.mm')}</option>
            </Select>
          </div>
        </div>
        {fieldError(FIELD.supportWidth)}
        {fieldError(FIELD.supportHeight)}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={FIELD.skill}>{ti('skillLabel')}</Label>
        <Select
          id={FIELD.skill}
          name="skill_level"
          defaultValue="intermediate"
          className="max-w-60"
        >
          {SKILL_LEVELS.map((level) => (
            <option key={level} value={level}>
              {ti(`skills.${level}`)}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={FIELD.goal}>{ti('goalLabel')}</Label>
        <p id="intake-goal-hint" className="text-sm text-muted-foreground">
          {ti('goalHint')}
        </p>
        <Textarea
          id={FIELD.goal}
          name="goal"
          rows={3}
          maxLength={MAX_GOAL_LENGTH}
          aria-describedby={describedBy(FIELD.goal, 'intake-goal-hint')}
          aria-invalid={errorFor(FIELD.goal) !== undefined}
        />
        {fieldError(FIELD.goal)}
      </div>

      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? ti('submitting') : ti('submit')}
        </Button>
      </div>
    </form>
  );
};
