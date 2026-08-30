/**
 * WCAG 2.2 contrast measurement for the per-app design tokens.
 *
 * `fascia` owns the token *contract* — which names exist and which of them are
 * text-bearing — while each app's `globals.css` supplies the *values* (ui-shell
 * spec). This module is the contract's verification half: it reads those
 * four stylesheets, resolves every pairing that actually renders, and reports
 * the measured ratio.
 *
 * Two consumers share it, so the numbers can never disagree:
 *   - `contrast.test.ts` — fails the build on an AA regression.
 *   - `scripts/reports/contrast-report.mjs` — regenerates `docs/contrast-report/contrast.md`.
 *
 * Colour maths note: the tokens are authored in oklch, but WCAG 1.4.3 is defined
 * on 8-bit sRGB. So we convert oklch → linear sRGB → gamma-encoded 8-bit, and
 * only then apply the WCAG luminance formula. Round-tripping through 8 bits is
 * deliberate: it is what a browser rasterises and what a devtools/axe check
 * reports, so a ratio here matches a ratio measured on the running app.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Which stylesheet block a token set came from. */
export type Mode = 'light' | 'dark';

/** An 8-bit sRGB colour, the space WCAG contrast is defined in. */
export type Rgb = {
  red: number;
  green: number;
  blue: number;
};

/** An oklch colour with lightness as a 0–1 fraction, hue in degrees. */
export type Oklch = {
  lightness: number;
  chroma: number;
  hue: number;
};

/**
 * What a pairing is measured against, and whether missing it is an error.
 *
 * `body` is normal-size text (WCAG 1.4.3, 4.5:1). `large` is text at
 * >=18.66px bold or >=24px (3:1). `ui` is in scope for WCAG 1.4.11 (3:1) —
 * the boundary that identifies a control, a focus indicator, or a graphical
 * object needed to understand content. Those three are *asserted*: below the
 * bar is a build failure.
 *
 * `advisory` is measured against the same 3:1 as `ui` but never fails the
 * build — it reports a warning instead. It is for boundaries we have decided
 * to keep an eye on without committing to the bar yet, currently the page and
 * card divider rules.
 *
 * `decorative` is measured and reported with no bar at all. 1.4.11 explicitly
 * exempts purely aesthetic boundaries, and a card's drop edge carries no
 * information a sighted user needs. Holding those to 3:1 would manufacture
 * failures and force every surface outline to go heavy, so they are recorded
 * for the baseline and left unbarred. The distinction is the whole reason
 * `--input` and `--border` stopped being the same value: an input's outline
 * *is* the control, a divider is not.
 */
export type PairKind = 'body' | 'large' | 'ui' | 'advisory' | 'decorative';

/** The ratio a pairing is measured against, asserted or not. 0 means unbarred. */
export const TARGET_RATIO: Record<PairKind, number> = {
  body: 4.5,
  large: 3,
  ui: 3,
  advisory: 3,
  decorative: 0,
};

/** Whether falling short of the target fails the build rather than warning. */
export const IS_ASSERTED: Record<PairKind, boolean> = {
  body: true,
  large: true,
  ui: true,
  advisory: false,
  decorative: false,
};

/**
 * The bar a pairing must clear to avoid an *error*. 0 for the unasserted kinds.
 *
 * Kept distinct from `TARGET_RATIO` so an advisory pairing can be measured
 * against 3:1 and reported against 3:1 while still never failing the build.
 */
export const REQUIRED_RATIO: Record<PairKind, number> = {
  body: 4.5,
  large: 3,
  ui: 3,
  advisory: 0,
  decorative: 0,
};

/**
 * How much headroom above the target a pairing needs before it reads as a
 * clean pass rather than a warning.
 *
 * An absolute epsilon, not a percentage. The measured ratio is only as precise
 * as the 8-bit sRGB round trip it is derived from, so a pairing sitting at
 * 3.09:1 against a 3:1 bar is not meaningfully clear of it — it is one anchor
 * nudge, one browser rounding difference, or one antialiased edge away from
 * failing. Reporting that as a pass claims a confidence the number does not
 * carry. A fixed 0.25 keeps that judgement independent of how high the bar is.
 */
export const WARN_MARGIN = 0.25;

/** How a measured pairing is reported. */
export type Severity = 'pass' | 'warn' | 'error';

/**
 * Classifies one measurement.
 *
 * Note this consumes the *unrounded* ratio on purpose: rounding to two decimals
 * before comparing would let 2.996:1 present itself as `3.00:1` and clear a 3:1
 * bar, which is the build gate passing on a display artefact.
 */
export const severityFor = (ratio: number, kind: PairKind): Severity => {
  const target = TARGET_RATIO[kind];
  if (target === 0) return 'pass';
  if (ratio < target) return IS_ASSERTED[kind] ? 'error' : 'warn';
  return ratio < target + WARN_MARGIN ? 'warn' : 'pass';
};

/**
 * A colour reference in a pairing.
 *
 * `alpha` + `over` model the tinted surfaces the components actually paint —
 * e.g. the destructive button is `bg-destructive/10` on top of the card, not
 * an opaque `--destructive`. Measuring the opaque token there would report a
 * contrast that never appears on screen.
 */
export type ColorRef = {
  token: string;
  alpha?: number;
  over?: string;
};

export type Pair = {
  /** Label used in the generated report and in test failure messages. */
  name: string;
  foreground: ColorRef;
  background: ColorRef;
  kind: PairKind;
  /** Why this pairing is checked, when it is not self-evident. */
  note?: string;
};

export type PairResult = {
  app: string;
  mode: Mode;
  name: string;
  kind: PairKind;
  foreground: string;
  background: string;
  /** Unrounded. Format with `formatRatio` for display; never round to compare. */
  ratio: number;
  /** What the pairing is measured against, asserted or not. 0 when unbarred. */
  target: number;
  /** The bar that makes a shortfall an error. 0 for advisory and decorative. */
  required: number;
  /** Whether a shortfall fails the build. */
  asserted: boolean;
  severity: Severity;
  /** True unless this is an error — i.e. warnings do not fail the gate. */
  passes: boolean;
};

/* -------------------------------------------------------------------------- */
/* Colour conversion                                                          */
/* -------------------------------------------------------------------------- */

const OKLCH_PATTERN = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)deg\s*\)$/;

/** Parses the exact `oklch(L% C Hdeg)` form the token files are authored in. */
export const parseOklch = (value: string): Oklch => {
  const match = OKLCH_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Not a supported oklch value: ${value}`);
  }
  return {
    lightness: Number(match[1]) / 100,
    chroma: Number(match[2]),
    hue: Number(match[3]),
  };
};

/** Björn Ottosson's oklab → linear sRGB, via the LMS cone responses. */
const oklchToLinearSrgb = ({ lightness, chroma, hue }: Oklch) => {
  const radians = (hue * Math.PI) / 180;
  const aAxis = chroma * Math.cos(radians);
  const bAxis = chroma * Math.sin(radians);

  const longCube = lightness + 0.3963377774 * aAxis + 0.2158037573 * bAxis;
  const mediumCube = lightness - 0.1055613458 * aAxis - 0.0638541728 * bAxis;
  const shortCube = lightness - 0.0894841775 * aAxis - 1.291485548 * bAxis;

  const long = longCube ** 3;
  const medium = mediumCube ** 3;
  const short = shortCube ** 3;

  return {
    red: 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    green: -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    blue: -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  };
};

/** sRGB transfer function: linear-light 0–1 → gamma-encoded 0–1. */
const encodeGamma = (channel: number) => {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
};

/**
 * True when the colour falls outside the sRGB gamut and had to be clipped.
 *
 * Clipping shifts the rendered hue, so a clipped token would make the measured
 * ratio a fiction. The palettes are low-chroma and should never trip this; the
 * test asserts it stays that way.
 */
export const isOutOfSrgbGamut = (color: Oklch): boolean => {
  const linear = oklchToLinearSrgb(color);
  const tolerance = 1e-6;
  return [linear.red, linear.green, linear.blue].some(
    (channel) => channel < -tolerance || channel > 1 + tolerance,
  );
};

export const oklchToRgb = (color: Oklch): Rgb => {
  const linear = oklchToLinearSrgb(color);
  return {
    red: Math.round(encodeGamma(linear.red) * 255),
    green: Math.round(encodeGamma(linear.green) * 255),
    blue: Math.round(encodeGamma(linear.blue) * 255),
  };
};

export const rgbToHex = ({ red, green, blue }: Rgb): string =>
  `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

/** Composites a translucent colour over an opaque one, in 8-bit sRGB. */
export const compositeOver = (top: Rgb, bottom: Rgb, alpha: number): Rgb => ({
  red: Math.round(top.red * alpha + bottom.red * (1 - alpha)),
  green: Math.round(top.green * alpha + bottom.green * (1 - alpha)),
  blue: Math.round(top.blue * alpha + bottom.blue * (1 - alpha)),
});

/** WCAG 2.x relative luminance from an 8-bit sRGB triplet. */
export const relativeLuminance = ({ red, green, blue }: Rgb): number => {
  const linearise = (channel: number) => {
    const scaled = channel / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearise(red) + 0.7152 * linearise(green) + 0.0722 * linearise(blue);
};

/**
 * WCAG 2.x contrast ratio, at full precision.
 *
 * Deliberately *not* rounded. Callers round for display; nothing rounds before
 * comparing against a bar. An earlier version rounded here to two decimals,
 * which meant a true 2.996:1 was compared as 3.00 and passed — the gate
 * agreeing with the report because both were reading the same rounded fiction.
 */
export const contrastRatio = (foreground: Rgb, background: Rgb): number => {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
};

/** The two-decimal form every report and failure message quotes. */
export const formatRatio = (ratio: number): string => ratio.toFixed(2);

/* -------------------------------------------------------------------------- */
/* Token extraction                                                           */
/* -------------------------------------------------------------------------- */

export type TokenSet = Record<string, string>;

const blockPattern = (selector: string) => new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');

/**
 * Pulls the custom properties out of one selector block.
 *
 * Only `:root` and `.dark` are read: `@theme inline` maps Tailwind colour
 * utilities onto these same variables, so it carries no independent values.
 */
export const readTokenBlock = (css: string, selector: string): TokenSet => {
  const block = blockPattern(selector).exec(css);
  if (!block) {
    throw new Error(`No \`${selector}\` block found`);
  }
  const tokens: TokenSet = {};
  const declarations = block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g);
  for (const [, name, value] of declarations) {
    tokens[name] = value.trim();
  }
  return tokens;
};

export const readModes = (css: string): Record<Mode, TokenSet> => ({
  light: readTokenBlock(css, ':root'),
  dark: readTokenBlock(css, '\\.dark'),
});

/* -------------------------------------------------------------------------- */
/* The pairing matrix                                                         */
/* -------------------------------------------------------------------------- */

const on = (
  name: string,
  foreground: string,
  background: string,
  kind: PairKind,
  note?: string,
): Pair => ({
  name,
  foreground: { token: foreground },
  background: { token: background },
  kind,
  note,
});

/**
 * Every pairing the apps actually render, not every pairing the tokens permit.
 *
 * Grouped by what breaks if it fails: page and surface text first, then the
 * roles `--primary` drives (buttons *and* links — the reason the shell spec keeps
 * electric cyan off this token), then the tinted destructive surfaces, then the
 * non-text boundaries and chart marks at the 3:1 bar.
 */
export const PAIRS: Pair[] = [
  // Body text on each surface.
  on('body text on page', 'foreground', 'background', 'body'),
  on('body text on card', 'card-foreground', 'card', 'body'),
  on('body text on popover', 'popover-foreground', 'popover', 'body'),
  on('body text on secondary', 'secondary-foreground', 'secondary', 'body'),
  on('body text on muted', 'foreground', 'muted', 'body'),
  on('body text on accent', 'accent-foreground', 'accent', 'body'),

  // Muted text is the most common near-miss — it is dimmed by design.
  on('muted text on page', 'muted-foreground', 'background', 'body'),
  on('muted text on card', 'muted-foreground', 'card', 'body'),
  on('muted text on muted surface', 'muted-foreground', 'muted', 'body'),

  // `--primary` is both a button fill and the link colour.
  on('button label on primary', 'primary-foreground', 'primary', 'body'),
  on(
    'link text on page',
    'primary',
    'background',
    'body',
    'Inline links take --primary as text, so it must clear the body bar.',
  ),
  on('link text on card', 'primary', 'card', 'body'),

  // Destructive renders as text on a 10% tint, never as an opaque fill.
  {
    name: 'destructive text on tint (page)',
    foreground: { token: 'destructive' },
    background: { token: 'destructive', alpha: 0.1, over: 'background' },
    kind: 'body',
    note: 'Matches `bg-destructive/10 text-destructive` in button and badge.',
  },
  {
    name: 'destructive text on tint (card)',
    foreground: { token: 'destructive' },
    background: { token: 'destructive', alpha: 0.1, over: 'card' },
    kind: 'body',
  },

  // Sidebar is a separate surface with its own token family.
  on('sidebar text', 'sidebar-foreground', 'sidebar', 'body'),
  on('sidebar active item', 'sidebar-primary-foreground', 'sidebar-primary', 'body'),
  on('sidebar hovered item', 'sidebar-accent-foreground', 'sidebar-accent', 'body'),

  // In scope for 1.4.11 — the outline IS the control. Input, textarea and the
  // unchecked checkbox all render `border-input` over `bg-transparent`, so this
  // pairing is the only thing marking where the field is.
  on(
    'input border on page',
    'input',
    'background',
    'ui',
    'Sole boundary of input/textarea/checkbox — they are `bg-transparent`.',
  ),
  on('input border on card', 'input', 'card', 'ui'),

  // Focus indicators (2.4.11 / 1.4.11).
  on('focus ring on page', 'ring', 'background', 'ui'),
  on('focus ring on card', 'ring', 'card', 'ui'),
  on('sidebar focus ring', 'sidebar-ring', 'sidebar', 'ui'),

  // Chart marks are graphical objects required to understand the content.
  on('chart 1 on card', 'chart-1', 'card', 'ui'),
  on('chart 2 on card', 'chart-2', 'card', 'ui'),
  on('chart 3 on card', 'chart-3', 'card', 'ui'),
  on('chart 4 on card', 'chart-4', 'card', 'ui'),
  on('chart 5 on card', 'chart-5', 'card', 'ui'),

  // Warned on, not asserted — measured against 3:1, reported as a warning when
  // short. A divider rule is exempt under 1.4.11, but these two are the ones
  // most likely to be doing real separating work, so they stay visible.
  on('divider on page', 'border', 'background', 'advisory'),
  on('divider on card', 'border', 'card', 'advisory'),

  // Recorded with no bar — see the `decorative` note on PairKind.
  on('card edge against page', 'card', 'background', 'decorative'),
  on('sidebar divider', 'sidebar-border', 'sidebar', 'decorative'),
];

/**
 * Tokens that carry text and therefore may never hold a low-contrast accent.
 *
 * This is the machine-readable half of the shell spec rule ("constrain cyan to
 * non-text roles"): the guardrail is not "avoid a hue", it is "these token
 * names are text and are held to 4.5:1", which the pair matrix above enforces.
 */
export const TEXT_ROLE_TOKENS = [
  'foreground',
  'card-foreground',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary-foreground',
  'muted-foreground',
  'accent-foreground',
  'destructive',
  'sidebar-foreground',
  'sidebar-primary-foreground',
  'sidebar-accent-foreground',
] as const;

/* -------------------------------------------------------------------------- */
/* Inter-app separation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Perceptual distance between two colours, as Euclidean distance in oklab.
 *
 * Contrast answers "can this be read on that". It says nothing about whether
 * two *apps* look like different products, and optimising each app toward its
 * own brief in isolation can quietly converge them all on the same hue while
 * every contrast check still passes. That is exactly what happened on the first
 * pass. This is the missing measure.
 */
export const deltaEOk = (first: string, second: string): number => {
  const toLab = (value: string) => {
    const { lightness, chroma, hue } = parseOklch(value);
    const radians = (hue * Math.PI) / 180;
    return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
  };
  const [l1, a1, b1] = toLab(first);
  const [l2, a2, b2] = toLab(second);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
};

/**
 * The apps that are meant to look like distinct products.
 *
 * `entry` is deliberately excluded — it mirrors the studio skin on purpose,
 * so measuring its distance from studio would report a failure for a decision
 * that was made deliberately.
 */
export const DISTINCT_APPS = ['studio', 'operations'] as const;

/** The tokens that carry an app's identity: what fills the screen, and the accent. */
export const IDENTITY_TOKENS = ['primary', 'background'] as const;

/**
 * Floor for inter-app separation.
 *
 * Deliberately low. This is a "did something collapse" guard, not a design bar —
 * whether the apps feel distinct enough is a judgement call that belongs to a
 * human looking at them, not to a threshold. It exists to catch the specific
 * regression where a well-meant per-app tweak pulls two surfaces onto the same
 * colour. Raising it to enforce taste would make it a nuisance.
 */
export const MIN_APP_SEPARATION = 0.025;

export type SeparationResult = {
  token: string;
  mode: Mode;
  apps: [string, string];
  distance: number;
  meetsFloor: boolean;
};

/** Measures every app-vs-app distance for the identity tokens, in both modes. */
export const measureSeparation = (
  tokensByApp: Record<string, Record<Mode, TokenSet>>,
): SeparationResult[] => {
  const names = Object.keys(tokensByApp);
  const results: SeparationResult[] = [];
  for (const token of IDENTITY_TOKENS) {
    for (const mode of ['light', 'dark'] as Mode[]) {
      for (let ii = 0; ii < names.length; ii++) {
        for (let jj = ii + 1; jj < names.length; jj++) {
          const first = tokensByApp[names[ii]][mode][token];
          const second = tokensByApp[names[jj]][mode][token];
          if (!first || !second) continue;
          const distance = deltaEOk(first, second);
          results.push({
            token,
            mode,
            apps: [names[ii], names[jj]],
            distance,
            meetsFloor: distance >= MIN_APP_SEPARATION,
          });
        }
      }
    }
  }
  return results;
};

/* -------------------------------------------------------------------------- */
/* Auditing                                                                   */
/* -------------------------------------------------------------------------- */

const resolve = (ref: ColorRef, tokens: TokenSet): Rgb => {
  const value = tokens[ref.token];
  if (!value) {
    throw new Error(`Missing token --${ref.token}`);
  }
  const solid = oklchToRgb(parseOklch(value));
  if (ref.alpha === undefined || !ref.over) {
    return solid;
  }
  const beneath = tokens[ref.over];
  if (!beneath) {
    throw new Error(`Missing token --${ref.over}`);
  }
  return compositeOver(solid, oklchToRgb(parseOklch(beneath)), ref.alpha);
};

const describe = (ref: ColorRef) =>
  ref.alpha !== undefined && ref.over
    ? `--${ref.token}/${Math.round(ref.alpha * 100)} over --${ref.over}`
    : `--${ref.token}`;

/** Measures every pairing for one app, across both modes. */
export const auditApp = (app: string, css: string): PairResult[] => {
  const modes = readModes(css);
  return (Object.keys(modes) as Mode[]).flatMap((mode) =>
    PAIRS.map((pair) => {
      const tokens = modes[mode];
      const ratio = contrastRatio(
        resolve(pair.foreground, tokens),
        resolve(pair.background, tokens),
      );
      const severity = severityFor(ratio, pair.kind);
      return {
        app,
        mode,
        name: pair.name,
        kind: pair.kind,
        foreground: describe(pair.foreground),
        background: describe(pair.background),
        ratio,
        target: TARGET_RATIO[pair.kind],
        required: REQUIRED_RATIO[pair.kind],
        asserted: IS_ASSERTED[pair.kind],
        severity,
        passes: severity !== 'error',
      };
    }),
  );
};

/* -------------------------------------------------------------------------- */
/* Locating the stylesheets                                                   */
/* -------------------------------------------------------------------------- */

/** The three surfaces, in the order the report lists them. */
export const APPS = ['entry', 'studio', 'operations'] as const;

export type App = (typeof APPS)[number];

/**
 * Repo root, found by walking up to the workspace marker.
 *
 * Deliberately not derived from `import.meta.url`: Vite rewrites that to a
 * `/@fs/…` specifier when vitest loads this module, which silently produces a
 * bogus path. Walking up to `pnpm-workspace.yaml` behaves the same under plain
 * node, under vitest, and from any working directory.
 */
export const repoRoot = (): string => {
  let directory = dirname(fileURLToPath(import.meta.url).replace(/^\/@fs/, ''));
  while (!existsSync(join(directory, 'pnpm-workspace.yaml'))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error('Could not locate the workspace root (no pnpm-workspace.yaml found)');
    }
    directory = parent;
  }
  return directory;
};

export const globalsCssPath = (app: App): string =>
  join(repoRoot(), 'apps', app, 'src', 'app', 'globals.css');
