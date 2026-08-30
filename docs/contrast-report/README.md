# Token contrast

Measured WCAG 2.2 contrast for every design-token pairing the three apps actually render,
in light and dark. Everything in this directory is **generated** — nothing here is
hand-edited.

## Layout

| Path | Notes |
| --- | --- |
| `contrast.md` | **generated** — the human report: ratios per app and mode, plus provenance |
| `contrast.json` | **generated** — the same data machine-readable, for anything that shouldn't parse markdown |
| `../../packages/fascia/src/theme/contrast.ts` | the measurement module — also what `contrast.test.ts` asserts against |
| `../../scripts/reports/contrast-report.mjs` | the generator (`pnpm contrast:report`) |
| `../../apps/*/src/app/globals.css` | the inputs — `fascia` owns the token *contract*, the apps own the *values* |

## Commands

```sh
pnpm contrast:report        # regenerate both files
pnpm contrast:check         # measure only, write nothing — exits non-zero on an error
pnpm contrast:check:strict  # same, but warnings fail too
```

`contrast:check` is the CI face of the same module, and runs as part of `pnpm check:all`.

## Why it's generated

The report is the **baseline the next palette change is measured against**: move an anchor,
rerun, and the diff shows which pairings shifted and by how much. A hand-kept table of ~180
ratios would be wrong within a commit, and a number nobody recomputed is worse than no
number — it reads as verified when it isn't. Regenerating from the same module the test
suite asserts against is what stops the doc and the build gate from disagreeing.

Both files carry a **provenance block**: a SHA-256 over the exact bytes of every input that
can change a number. That is the staleness signal — `contrast:check` compares fingerprints
rather than diffing a file whose header carries a generation date and therefore always
differs.

## Scope

The report is purely *descriptive*. It records what the stylesheets currently measure; it
carries no opinion about what the palette should be. Palette intent lives with the design
decision that moved the anchors, not here.

It also measures perceptual separation (ΔE in oklab) between the apps' identity tokens —
a "did the three apps collapse onto one look" guard, deliberately set at a low floor.
Whether they feel distinct enough is a judgement call for a human looking at them.

Prose linting is disabled for `contrast.md` in `.vale.ini` — a finding in a wholesale-
regenerated file has nobody to fix it and would return on the next run. This README is
hand-written and is linted normally.
