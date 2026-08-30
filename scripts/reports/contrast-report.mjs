#!/usr/bin/env node
/**
 * Regenerates docs/contrast-report/contrast.md and docs/contrast-report/contrast.json from the
 * three apps' `globals.css`.
 *
 * The outputs are GENERATED — never hand-edit them. They are purely
 * *descriptive*: the measured WCAG 2.2 ratio for every token pairing the apps
 * actually render, as the stylesheets currently stand. They carry no opinion
 * about what the palette should be; palette intent lives in the ui-shell spec
 * and in the issue that moved the anchors.
 *
 *   node scripts/reports/contrast-report.mjs             (or: pnpm contrast:report)
 *   node scripts/reports/contrast-report.mjs --check     measure only, write nothing
 *   node scripts/reports/contrast-report.mjs --check --strict   warnings fail too
 *
 * Why a generated doc at all: the point of the baseline is that the *next*
 * palette change can see what it moved. A hand-kept table of ~180 ratios would
 * be wrong within one commit, and a number nobody recomputed is worse than no
 * number — it reads as verified when it is not. So the ratios are regenerated
 * on demand from the same module the test suite asserts against
 * (`packages/fascia/src/theme/contrast.ts`), which is what stops the doc and
 * the gate from ever disagreeing.
 *
 * `--check` is the CI face of that module. It measures and classifies without
 * touching the working tree, so it is safe to run on a pull request, and it
 * exits non-zero on an error — a pairing genuinely below its bar. Warnings are
 * printed but do not fail unless `--strict` is passed.
 *
 * On provenance: a report that quotes 180 ratios has to say which inputs
 * produced them, or a stale copy is indistinguishable from a fresh one. It
 * records a SHA-256 over the exact bytes it read — the three stylesheets, the
 * measurement module, and this script — so `--check` can tell you the doc is
 * stale by comparing fingerprints rather than by diffing a file whose header
 * carries a generation date and therefore always differs.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import {
  APPS,
  auditApp,
  DISTINCT_APPS,
  formatRatio,
  globalsCssPath,
  isOutOfSrgbGamut,
  measureSeparation,
  MIN_APP_SEPARATION,
  oklchToRgb,
  parseOklch,
  readModes,
  repoRoot,
  rgbToHex,
  WARN_MARGIN,
} from '../../packages/fascia/src/theme/contrast.ts'

const argv = process.argv.slice(2)
const CHECK_ONLY = argv.includes('--check')
const STRICT = argv.includes('--strict')

const ROOT = repoRoot()
const OUT_MD = `${ROOT}/docs/contrast-report/contrast.md`
const OUT_JSON = `${ROOT}/docs/contrast-report/contrast.json`
const SELF = `${ROOT}/scripts/reports/contrast-report.mjs`
const MODULE = `${ROOT}/packages/fascia/src/theme/contrast.ts`

const CHARACTER = {
  entry: 'Public apex holding page. Mirrors the studio skin so the first and second screens feel continuous.',
  studio: 'Soft welcoming light blues on warm sand — the softest, roundest of the skins.',
  operations: 'Deep marine and high density, with cyan leading the status and chart marks.',
}

const KIND_LABEL = {
  body: 'body text',
  large: 'large text',
  ui: 'UI / graphical',
  advisory: 'advisory',
  decorative: 'decorative',
}

const MARK = { pass: '✅', warn: '⚠️', error: '❌' }

/* -------------------------------------------------------------------------- */
/* Provenance                                                                 */
/* -------------------------------------------------------------------------- */

const rel = (path) => relative(ROOT, path)

/**
 * Every file whose bytes can change a number in this report.
 *
 * The stylesheets supply the values, the module supplies the pairing matrix and
 * the thresholds, and this script supplies the presentation. Leaving any of
 * them out would let the fingerprint claim "nothing moved" while a number had.
 */
const INPUT_PATHS = [...APPS.map(globalsCssPath), MODULE, SELF]

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

const inputs = INPUT_PATHS.map((path) => {
  const bytes = readFileSync(path)
  return { path: rel(path), sha256: digest(bytes) }
})

/**
 * One fingerprint over the per-file digests, not over the concatenated bytes.
 *
 * Hashing `path + sha` pairs means a file *rename* changes the fingerprint too,
 * and it keeps each input's own digest reportable in the JSON sidecar — which is
 * what tells you *which* input moved, rather than only that something did.
 */
const fingerprint = digest(inputs.map((input) => `${input.path}:${input.sha256}`).join('\n')).slice(0, 16)

/** Best-effort HEAD. A tarball checkout has no git, and that is not an error. */
const headCommit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
})()

/** Whether the working tree differs from HEAD for the inputs above. */
const inputsDirty = (() => {
  if (!headCommit) return null
  try {
    const status = execFileSync('git', ['status', '--porcelain', '--', ...INPUT_PATHS], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return status.trim().length > 0
  } catch {
    return null
  }
})()

const version = JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')).version

/**
 * Generation date only, never a time.
 *
 * The date is what a reader needs to judge staleness. A timestamp would make
 * every regeneration a diff even when no ratio moved, and the fingerprint above
 * already answers "did the inputs change" far more precisely than a clock does.
 */
const generatedOn = new Date().toISOString().slice(0, 10)

const provenance = {
  generated_on: generatedOn,
  generated_by: rel(SELF),
  version,
  head_commit: headCommit,
  inputs_dirty: inputsDirty,
  inputs_fingerprint: fingerprint,
  inputs,
}

/* -------------------------------------------------------------------------- */
/* Measurement                                                                */
/* -------------------------------------------------------------------------- */

const cssByApp = Object.fromEntries(APPS.map((app) => [app, readFileSync(globalsCssPath(app), 'utf8')]))
const resultsByApp = Object.fromEntries(APPS.map((app) => [app, auditApp(app, cssByApp[app])]))
const allResults = APPS.flatMap((app) => resultsByApp[app])

const errors = allResults.filter((rr) => rr.severity === 'error')
const warnings = allResults.filter((rr) => rr.severity === 'warn')

/**
 * Decorative pairings are counted apart from the passes.
 *
 * They carry no bar, so folding them into "pass" would inflate the healthy
 * number with rows that were never at risk — a card edge at 1.13:1 reported as
 * a pass is the kind of true-but-misleading total this report exists to avoid.
 */
const unbarred = allResults.filter((rr) => rr.target === 0)
const passes = allResults.filter((rr) => rr.target > 0 && rr.severity === 'pass')

const gamutIssues = APPS.flatMap((app) => {
  const modes = readModes(cssByApp[app])
  return Object.entries(modes).flatMap(([mode, tokens]) =>
    Object.entries(tokens)
      .filter(([, value]) => value.startsWith('oklch('))
      .filter(([, value]) => isOutOfSrgbGamut(parseOklch(value)))
      .map(([name, value]) => `${app} ${mode} \`--${name}\`: \`${value}\``),
  )
})

/**
 * Errors, then asserted warnings, then advisory warnings — the order you would
 * act on them in.
 *
 * Advisory rows sort last deliberately. The dividers sit around 1.2:1 against a
 * 3:1 target, so a pure tightest-first sort puts twelve rows we have already
 * decided to live with above the asserted near-misses that are one anchor nudge
 * from turning red. Rank is by intent, then by headroom within each band.
 */
const BAND = { error: 0, assertedWarn: 1, advisoryWarn: 2 }
const bandOf = (rr) => (rr.severity === 'error' ? BAND.error : rr.asserted ? BAND.assertedWarn : BAND.advisoryWarn)

const attention = [...errors, ...warnings].sort(
  (aa, bb) => bandOf(aa) - bandOf(bb) || aa.ratio / aa.target - bb.ratio / bb.target,
)

/* -------------------------------------------------------------------------- */
/* Check mode                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * GitHub renders these as inline annotations on the run, so a warning is
 * visible in the PR without anyone opening the log. Outside Actions they are
 * plain lines.
 */
const annotate = (level, result) => {
  const detail =
    `${result.app} ${result.mode} · ${result.name} ` +
    `(${result.foreground} on ${result.background}): ${formatRatio(result.ratio)}:1` +
    (result.target ? `, wants ${result.target}:1` : '')
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::${level} title=Contrast ${level}::${detail}`)
  } else {
    console.log(`  ${level === 'error' ? '✗' : '!'} ${detail}`)
  }
}

if (CHECK_ONLY) {
  const recorded = existsSync(OUT_JSON)
    ? JSON.parse(readFileSync(OUT_JSON, 'utf8')).provenance?.inputs_fingerprint
    : null

  console.log(
    `contrast: ${passes.length} pass · ${warnings.length} warn · ${errors.length} error ` +
      `· ${unbarred.length} unbarred (${allResults.length} pairings, ${APPS.length} apps x 2 modes)`,
  )
  console.log(`  inputs ${fingerprint} · ${version} · ${headCommit ? headCommit.slice(0, 7) : 'no git'}`)

  if (errors.length) {
    console.log('')
    for (const result of errors) annotate('error', result)
  }
  if (warnings.length) {
    console.log('')
    // Same ranking as the doc: asserted near-misses above the standing advisory rows.
    for (const result of attention.filter((rr) => rr.severity === 'warn')) annotate('warning', result)
    console.log(
      `\n  Warnings are pairings within ${WARN_MARGIN} of their bar, or advisory pairings below it. ` +
        'They do not fail the build unless --strict.',
    )
  }
  if (gamutIssues.length) {
    console.error(`\ncontrast: ${gamutIssues.length} token(s) outside the sRGB gamut — every ratio above is a fiction.`)
    for (const issue of gamutIssues) console.error(`  ${issue.replace(/`/g, '')}`)
  }
  if (recorded && recorded !== fingerprint) {
    console.log(`\ncontrast: ${rel(OUT_MD)} is stale (recorded ${recorded}, inputs are ${fingerprint}).`)
    console.log('  Run `pnpm contrast:report` to regenerate it.')
  }

  const fatal = errors.length > 0 || gamutIssues.length > 0 || (STRICT && warnings.length > 0)
  process.exit(fatal ? 1 : 0)
}

/* -------------------------------------------------------------------------- */
/* Report rendering                                                           */
/* -------------------------------------------------------------------------- */

const swatch = (value) => rgbToHex(oklchToRgb(parseOklch(value)))

const table = (results) => {
  const lines = [
    '| Pairing | Foreground | Background | Kind | Ratio | Wants | |',
    '| --- | --- | --- | --- | --: | --: | :-: |',
  ]
  for (const rr of results) {
    const wants = rr.target === 0 ? 'n/a' : `${rr.target}:1`
    const mark = rr.target === 0 ? '·' : MARK[rr.severity]
    lines.push(
      `| ${rr.name} | \`${rr.foreground}\` | \`${rr.background}\` | ${KIND_LABEL[rr.kind]} | ${formatRatio(rr.ratio)}:1 | ${wants} | ${mark} |`,
    )
  }
  return lines.join('\n')
}

const anchorTable = (tokens) => {
  const anchors = ['background', 'foreground', 'primary', 'accent', 'input', 'border']
  const lines = ['| Token | oklch | sRGB |', '| --- | --- | --- |']
  for (const name of anchors) {
    const value = tokens[name]
    if (!value) continue
    lines.push(`| \`--${name}\` | \`${value}\` | \`${swatch(value)}\` |`)
  }
  return lines.join('\n')
}

const sections = APPS.map((app) => {
  const results = resultsByApp[app]
  const modes = readModes(cssByApp[app])
  const body = [`## ${app}`, '', CHARACTER[app], '']

  for (const mode of ['light', 'dark']) {
    const forMode = results.filter((rr) => rr.mode === mode)
    const measured = forMode.filter((rr) => rr.target > 0)
    const counts = {
      error: measured.filter((rr) => rr.severity === 'error').length,
      warn: measured.filter((rr) => rr.severity === 'warn').length,
    }
    const lowest = Math.min(...measured.map((rr) => rr.ratio / rr.target))

    body.push(
      `### ${app} — ${mode}`,
      '',
      `${measured.length} measured pairings, ${counts.error} failing, ${counts.warn} warning. ` +
        `Tightest sits at ${(lowest * 100).toFixed(0)}% of the ratio it wants.`,
      '',
      anchorTable(modes[mode]),
      '',
      table(forMode),
      '',
    )
  }
  return body.join('\n')
})

const separation = measureSeparation(
  Object.fromEntries(DISTINCT_APPS.map((app) => [app, readModes(cssByApp[app])])),
).sort((aa, bb) => aa.distance - bb.distance)

const hueSpread = (mode) => {
  const hues = DISTINCT_APPS.map((app) => parseOklch(readModes(cssByApp[app])[mode].primary).hue)
  return (Math.max(...hues) - Math.min(...hues)).toFixed(0)
}

const separationSection = `## Separation between the apps

Contrast answers "can this be read on that". It cannot see whether the apps still look
like *different products* — tuning each one toward its own brief in isolation can converge
them all on the same hue while every ratio above still passes. This section is that missing
measure: perceptual distance (ΔE in oklab) between the apps' identity tokens.

\`entry\` is excluded on purpose — it mirrors the studio skin by design, so measuring it
here would report a deliberate decision as a failure.

Primary hue spread across the three: **${hueSpread('light')}°** light, **${hueSpread('dark')}°** dark.

| Token | Mode | Apps | ΔE | |
| --- | --- | --- | --: | :-: |
${separation
  .map(
    (ss) =>
      `| \`--${ss.token}\` | ${ss.mode} | ${ss.apps.join(' vs ')} | ${ss.distance.toFixed(4)} | ${ss.meetsFloor ? '✅' : '❌'} |`,
  )
  .join('\n')}

The floor is **${MIN_APP_SEPARATION}**, and it is deliberately low: a "did something collapse"
guard, not a design bar. Whether the apps feel distinct enough is a judgement call for a human
looking at them. The values live in each app's \`src/app/globals.css\`; rerun this report after changing any of them.`

const provenanceSection = `## Provenance

| | |
| --- | --- |
| Generated | ${generatedOn} |
| Repo version | \`${version}\` |
| HEAD | ${headCommit ? `\`${headCommit}\`` : '*not a git checkout*' } |
| Working tree | ${inputsDirty === null ? '*unknown*' : inputsDirty ? '**dirty** — inputs differ from HEAD' : 'clean' } |
| Inputs fingerprint | \`${fingerprint}\` |

The fingerprint is a SHA-256 over the exact bytes of every file that can change a
number below. It is what makes staleness detectable: \`pnpm contrast:check\` recomputes
it and tells you the doc needs regenerating, without diffing a file whose header
carries a date and therefore always differs. HEAD is recorded for human orientation —
it moves on commits that touch none of these files, so it is not the staleness signal.

| Input | sha256 |
| --- | --- |
${inputs.map((input) => `| \`${input.path}\` | \`${input.sha256.slice(0, 16)}\` |`).join('\n')}

\`docs/contrast-report/contrast.json\` carries the same provenance plus every measured ratio, for
anything that wants the numbers without parsing markdown.`

const doc = `# Token contrast baseline

<!-- GENERATED FILE — do not edit by hand. Run \`pnpm contrast:report\`. -->

Measured WCAG 2.2 contrast for every design-token pairing the three apps actually
render, in both light and dark. Regenerate with \`pnpm contrast:report\`; verify without
writing with \`pnpm contrast:check\`.

This file is the **baseline** the next palette change is measured against: change an
anchor, rerun, and the diff shows exactly which pairings moved and by how much.

- **Source of values** — each app's \`apps/<app>/src/app/globals.css\`. \`fascia\` owns the
  token *contract*; the apps own the *values*.
- **Source of ratios** — \`packages/fascia/src/theme/contrast.ts\`, the same module
  \`contrast.test.ts\` asserts against, so this table and the build gate cannot disagree.
- **The gates** — \`pnpm contrast:check\` in CI, and \`pnpm --filter @artloupe/fascia test\`
  locally. Both fail on any asserted pairing below its bar.

## How to read it

| Kind | Wants | Asserted | Why |
| --- | --: | :-: | --- |
| body text | 4.5:1 | yes | WCAG 1.4.3 — normal-size text. |
| large text | 3:1 | yes | WCAG 1.4.3 — >=24px, or >=18.66px bold. |
| UI / graphical | 3:1 | yes | WCAG 1.4.11 — a control's boundary, a focus indicator, or a chart mark needed to read the data. |
| advisory | 3:1 | no | Measured against 3:1 and **warned** on, never failed. The page and card divider rules: exempt under 1.4.11, but the ones most likely to be doing real separating work, so they stay visible rather than silent. |
| decorative | n/a | no | Measured with no bar. 1.4.11 exempts purely aesthetic edges: a card's drop edge carries no information. Holding it to 3:1 would manufacture a failure and force every surface outline heavy. |

### Pass, warn, error

| Mark | Meaning |
| :-: | --- |
| ✅ | Clears what it wants by at least **${WARN_MARGIN}**. |
| ⚠️ | Clears it by less than ${WARN_MARGIN}, or is an advisory pairing below it. Does not fail CI. |
| ❌ | An asserted pairing below its bar. Fails CI. |
| · | Decorative — measured, unbarred. |

**Nothing is rounded before it is compared.** Ratios are quoted to two decimals, but the
comparison uses full precision, so a true 2.996:1 is an error and never a \`3.00\` that
reads as a pass. The ${WARN_MARGIN} margin exists for the same reason from the other side: a
pairing at 3.09:1 is one anchor nudge away from failing, and calling that a clean pass
claims a confidence the number does not carry.

Three conventions worth knowing:

- **There is no separate "system" palette.** All three apps mount \`next-themes\` with
  \`defaultTheme="system"\` and \`enableSystem\`, so the system setting resolves to the same
  \`:root\` or \`.dark\` block measured below. Covering light and dark covers system; a third
  table would be the same numbers twice.
- Ratios are computed oklch → linear sRGB → 8-bit sRGB, then through the WCAG luminance
  formula. The round trip through 8 bits is deliberate — it is what the browser rasterises,
  so a number here matches what axe or devtools reports on the running app.
- \`--destructive/10 over --card\` style entries measure the **composited** surface. The
  destructive button and badge paint \`bg-destructive/10\`, never an opaque fill, so
  measuring the opaque token would report a contrast that never appears on screen.

## Summary

- **${allResults.length} pairings** measured across ${APPS.length} apps x 2 modes.
- **${passes.length} pass · ${warnings.length} warn · ${errors.length} error**, plus ${unbarred.length} decorative pairings carrying no bar.
- **${gamutIssues.length} tokens outside the sRGB gamut.**${gamutIssues.length ? `\n\n${gamutIssues.map((ii) => `  - ${ii}`).join('\n')}` : ''}

### Everything not a clean pass

Errors first, then asserted pairings sitting inside the margin, then the advisory
dividers. The advisory rows are last on purpose: they are a standing decision, not a
regression, so they should never sit above a pairing that is one anchor nudge from red.

${
  attention.length
    ? ['| | App | Mode | Pairing | Kind | Ratio | Wants |', '| :-: | --- | --- | --- | --- | --: | --: |']
        .concat(
          attention.map(
            (rr) =>
              `| ${MARK[rr.severity]} | ${rr.app} | ${rr.mode} | ${rr.name} | ${KIND_LABEL[rr.kind]} | ${formatRatio(rr.ratio)}:1 | ${rr.target}:1 |`,
          ),
        )
        .join('\n')
    : 'None — every measured pairing clears what it wants by the full margin.'
}

${provenanceSection}

${separationSection}

${sections.join('\n')}`

mkdirSync(dirname(OUT_MD), { recursive: true })
writeFileSync(OUT_MD, `${doc.trimEnd()}\n`)
writeFileSync(
  OUT_JSON,
  `${JSON.stringify(
    {
      provenance,
      thresholds: { warn_margin: WARN_MARGIN, separation_floor: MIN_APP_SEPARATION },
      totals: {
        pairings: allResults.length,
        pass: passes.length,
        warn: warnings.length,
        error: errors.length,
        unbarred: unbarred.length,
        out_of_gamut: gamutIssues.length,
      },
      pairings: allResults.map((rr) => ({
        app: rr.app,
        mode: rr.mode,
        name: rr.name,
        kind: rr.kind,
        foreground: rr.foreground,
        background: rr.background,
        ratio: Number(formatRatio(rr.ratio)),
        target: rr.target,
        asserted: rr.asserted,
        severity: rr.severity,
      })),
      // Named fields rather than a positional pair, so `JSON.stringify` output is
      // already biome-canonical — biome inlines a short array that stringify always
      // expands, which would make every regeneration a formatting diff as well.
      separation: separation.map((ss) => ({
        token: ss.token,
        mode: ss.mode,
        app_a: ss.apps[0],
        app_b: ss.apps[1],
        distance: Number(ss.distance.toFixed(4)),
        meets_floor: ss.meetsFloor,
      })),
    },
    null,
    2,
  )}\n`,
)

console.log(
  `contrast: ${passes.length} pass · ${warnings.length} warn · ${errors.length} error ` +
    `· ${unbarred.length} unbarred -> ${rel(OUT_MD)}, ${rel(OUT_JSON)}`,
)
console.log(`  inputs ${fingerprint} · ${version} · ${headCommit ? headCommit.slice(0, 7) : 'no git'}`)
