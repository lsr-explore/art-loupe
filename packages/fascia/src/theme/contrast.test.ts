import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APPS,
  auditApp,
  contrastRatio,
  DISTINCT_APPS,
  formatRatio,
  globalsCssPath,
  isOutOfSrgbGamut,
  MIN_APP_SEPARATION,
  measureSeparation,
  oklchToRgb,
  parseOklch,
  readModes,
  readTokenBlock,
  rgbToHex,
  severityFor,
  TEXT_ROLE_TOKENS,
  WARN_MARGIN,
} from './contrast';

const cssFor = (app: (typeof APPS)[number]) => readFileSync(globalsCssPath(app), 'utf8');

/**
 * The conversion is only trustworthy if it reproduces values that are fixed by
 * the sRGB and WCAG specs, so pin it to those rather than to our own output.
 */
// @trace flow=platform.shell category=a11y
describe('colour conversion', () => {
  it.each([
    ['oklch(62.80% 0.2577 29.23deg)', '#ff0000'],
    ['oklch(86.64% 0.2948 142.50deg)', '#00ff00'],
    ['oklch(45.20% 0.3132 264.05deg)', '#0000ff'],
    ['oklch(100% 0 0deg)', '#ffffff'],
    ['oklch(0% 0 0deg)', '#000000'],
  ])('converts %s to %s', (value, hex) => {
    expect(rgbToHex(oklchToRgb(parseOklch(value)))).toBe(hex);
  });

  it('gives black on white the maximum ratio of 21:1', () => {
    const white = { red: 255, green: 255, blue: 255 };
    const black = { red: 0, green: 0, blue: 0 };
    expect(contrastRatio(black, white)).toBe(21);
  });

  it('matches the published ratio for the AA boundary grey #767676', () => {
    expect(
      contrastRatio({ red: 118, green: 118, blue: 118 }, { red: 255, green: 255, blue: 255 }),
    ).toBeCloseTo(4.54, 2);
  });

  it('reproduces the ~4.1:1 that retired the theme.md studio primary', () => {
    // The shell spec rejected sky-600 (#0284c7) with white button text.
    expect(
      contrastRatio({ red: 2, green: 132, blue: 199 }, { red: 255, green: 255, blue: 255 }),
    ).toBeCloseTo(4.1, 1);
  });

  it('rejects a value that is not the authored oklch form', () => {
    expect(() => parseOklch('#0284c7')).toThrow(/oklch/);
  });

  /**
   * The ratio used to be rounded to two decimals at source, so a true 2.996:1
   * was compared as `3.00` and cleared a 3:1 bar. The gate and the report both
   * read the same rounded fiction, which is exactly the failure mode a shared
   * module is supposed to prevent. Rounding is now display-only.
   */
  it('does not round before comparing against a bar', () => {
    expect(severityFor(2.996, 'ui')).toBe('error');
    expect(formatRatio(2.996)).toBe('3.00');
  });
});

/**
 * A measured ratio is only as precise as the 8-bit sRGB round trip it comes
 * from, so clearing a bar by hundredths is not clearing it. These cases pin the
 * three-way classification the CI check reports on.
 */
// @trace flow=platform.shell category=a11y
describe('severity classification', () => {
  it('warns on an asserted pairing that only just clears its bar', () => {
    expect(severityFor(3.09, 'ui')).toBe('warn');
    expect(severityFor(4.67, 'body')).toBe('warn');
  });

  it('passes once the pairing clears the bar by the full margin', () => {
    expect(severityFor(3 + WARN_MARGIN, 'ui')).toBe('pass');
    expect(severityFor(4.5 + WARN_MARGIN, 'body')).toBe('pass');
  });

  it('errors on an asserted pairing below its bar', () => {
    expect(severityFor(2.9, 'ui')).toBe('error');
    expect(severityFor(4.4, 'body')).toBe('error');
  });

  /**
   * The whole point of the kind: a divider short of 3:1 is visible in the
   * report and in CI output, but it never turns the build red.
   */
  it('warns rather than errors on an advisory pairing below its bar', () => {
    expect(severityFor(1.2, 'advisory')).toBe('warn');
  });

  it('leaves an unbarred decorative pairing as a pass at any ratio', () => {
    expect(severityFor(1.1, 'decorative')).toBe('pass');
  });
});

// @trace flow=platform.shell category=a11y
describe.each(APPS)('%s tokens', (app) => {
  const css = cssFor(app);

  it('defines both a light and a dark block', () => {
    const modes = readModes(css);
    expect(Object.keys(modes.light).length).toBeGreaterThan(0);
    expect(Object.keys(modes.dark).length).toBeGreaterThan(0);
  });

  /**
   * A clipped colour renders at a different hue than it was authored at, which
   * would make every measured ratio below a fiction.
   */
  it('keeps every token inside the sRGB gamut', () => {
    const modes = readModes(css);
    const clipped = Object.entries(modes).flatMap(([mode, tokens]) =>
      Object.entries(tokens)
        .filter(([, value]) => value.startsWith('oklch('))
        .filter(([, value]) => isOutOfSrgbGamut(parseOklch(value)))
        .map(([name, value]) => `${mode} --${name}: ${value}`),
    );
    expect(clipped).toEqual([]);
  });

  it('meets WCAG 2.2 AA on every asserted pairing', () => {
    const failures = auditApp(app, css)
      .filter((result) => !result.passes)
      .map(
        (result) =>
          `${result.mode} · ${result.name} (${result.foreground} on ${result.background}): ` +
          `${formatRatio(result.ratio)}:1, needs ${result.required}:1`,
      );
    expect(failures).toEqual([]);
  });

  /**
   * `--input` is the entire visible boundary of input, textarea and the
   * unchecked checkbox — they all render `bg-transparent`. It used to carry the
   * same value as the decorative `--border`, which is how it ended up at 1.2:1.
   * Keeping them distinct is the fix, so assert they never re-converge.
   */
  it('keeps --input distinct from the decorative --border', () => {
    const modes = readModes(css);
    for (const [mode, tokens] of Object.entries(modes)) {
      expect(tokens.input, `${mode} --input should not equal --border`).not.toBe(tokens.border);
    }
  });
});

/**
 * The apps are meant to read as distinct products. Contrast checks cannot see
 * this: on the first pass every pairing still passed AA while the three
 * primaries converged from a 33-degree hue spread to 12, because each app was
 * tuned toward its own brief in isolation. This is the guard for that.
 */
// @trace flow=platform.shell category=a11y
describe('the apps stay visually distinct from each other', () => {
  const tokensByApp = Object.fromEntries(DISTINCT_APPS.map((app) => [app, readModes(cssFor(app))]));

  it('keeps every app pair above the separation floor', () => {
    const collapsed = measureSeparation(tokensByApp)
      .filter((result) => !result.meetsFloor)
      .map(
        (result) =>
          `${result.mode} --${result.token}: ${result.apps.join(' vs ')} ` +
          `only ${result.distance.toFixed(4)} apart (floor ${MIN_APP_SEPARATION})`,
      );
    expect(collapsed).toEqual([]);
  });

  it('measures entry as a deliberate copy of studio, not a third identity', () => {
    const entry = readModes(cssFor('entry'));
    const studio = readModes(cssFor('studio'));
    expect(entry.light.primary).toBe(studio.light.primary);
    expect(entry.dark.background).toBe(studio.dark.background);
  });
});

/**
 * Entry's launch panels render the operations
 * palettes as scoped `.theme-*` blocks, hand-copied the same way entry's own skin
 * is copied from the studio app's.
 *
 * `readModes` deliberately reads only `:root` and `.dark`, so those blocks are
 * invisible to every contrast assertion above — which is correct (the values are
 * measured in their own apps) but leaves the copies unguarded. A palette pass that
 * moved operations' `--primary` and forgot entry would ship a stale panel that no
 * other test in this file can see. This is that guard: every token the panel block
 * declares must still equal its source. Entry may declare a subset — the panels
 * render no charts or sidebars — but never a *different* value.
 */
// @trace flow=platform.shell category=a11y
describe('entry panel skins stay in step with their source apps', () => {
  const entryCss = cssFor('entry');

  // Anchored to the line start. Unanchored, `\.theme-operations\s*\{` also matches
  // inside `.dark .theme-operations {`, and only source order would decide which
  // block the light assertion actually read.
  it.each([{ app: 'operations', selector: '^\\.theme-operations' }] as const)(
    'copies $app light values verbatim',
    ({ app, selector }) => {
      const panel = readTokenBlock(entryCss, selector);
      const source = readModes(cssFor(app)).light;

      expect(Object.keys(panel).length).toBeGreaterThan(0);
      for (const [name, value] of Object.entries(panel)) {
        expect(value, `--${name} has drifted from apps/${app}`).toBe(source[name]);
      }
    },
  );

  it.each([{ app: 'operations', selector: '^\\.dark \\.theme-operations' }] as const)(
    'copies $app dark values verbatim',
    ({ app, selector }) => {
      const panel = readTokenBlock(entryCss, selector);
      const source = readModes(cssFor(app)).dark;

      expect(Object.keys(panel).length).toBeGreaterThan(0);
      for (const [name, value] of Object.entries(panel)) {
        expect(value, `--${name} has drifted from apps/${app}`).toBe(source[name]);
      }
    },
  );

  /**
   * The studio panel is the absence of a scoped block — entry's ambient tokens
   * already are the studio skin. A `.theme-studio` block appearing here would
   * mean those values had acquired a second home, which is the drift this suite
   * exists to prevent.
   */
  it('has no redundant studio block', () => {
    // Matches a selector at a line start, not the bare string: the comment above
    // the panel skins names `.theme-studio` in prose to explain its absence, and
    // a substring check fails on the explanation for the rule it is enforcing.
    expect(entryCss).not.toMatch(/^\s*\.theme-studio\s*[,{]/m);
  });
});

/**
 * The shell spec rule, made executable: electric cyan is a non-text colour in
 * operations. It may lead the chart marks and status accents; it may never land
 * on a token that renders as text, where it cannot reach 4.5:1 on dark marine.
 */
// @trace flow=platform.shell category=a11y
describe('operations cyan is confined to non-text roles', () => {
  const isCyan = (value: string) => {
    const { chroma, hue } = parseOklch(value);
    return hue >= 180 && hue <= 215 && chroma > 0.08;
  };

  it('uses cyan as the dark chart lead', () => {
    const { dark } = readModes(cssFor('operations'));
    expect(isCyan(dark['chart-1'])).toBe(true);
  });

  it('never assigns cyan to a text-bearing token', () => {
    const modes = readModes(cssFor('operations'));
    const offenders = Object.entries(modes).flatMap(([mode, tokens]) =>
      TEXT_ROLE_TOKENS.filter((name) => tokens[name] && isCyan(tokens[name])).map(
        (name) => `${mode} --${name}: ${tokens[name]}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
