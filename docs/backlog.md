# Backlog

Known issues and deferred work, held here **until the GitHub repo and its project board
exist**. Once they do, these become real issues via the `backlog` skill and this file goes
away — GitHub is the source of truth, and `docs/backlog/issues.md` is its generated map.
Do not let the two compete.

## `i18n:check:unused` cannot see the shared-catalog merge

**Status:** open, deliberately deferred — revisit once the apps carry real copy.

`@artloupe/fascia` owns a shared chrome catalog (`packages/fascia/messages/*.json`) that
each app merges into its own at runtime through `withSharedMessages`. `i18n-check` analyses
one catalog against one source tree and knows nothing about that merge, so each side reports
the other's keys as phantom problems:

- **fascia** calls 15 keys unused — `session.*`, `errors.*`, `notFound.*`, `standalone.*`
  and friends — because the code that consumes them lives in the apps.
- **each app** reports `common`, `errors`, `language`, `notFound`, `standalone` as
  undefined, because fascia defines them.

Pointing fascia's `--unused` at the app sources inverts the problem rather than solving it:
unused drops to 1, undefined rises to 41.

**Why it is not fixed now.** Every option costs more than the noise does while the apps are
still scaffolds. `--ignore` per side over-hides, since `common` legitimately exists in both.
Generating a merged catalog for the checker to read means a build step in front of a lint.
Revisit when the apps have enough real copy that a genuinely dead key is worth catching.

**Already fixed, keep:** `--next-intl-translation-fn-type-alias Translate` on fascia's
script. `shell-labels.ts` calls `translate('footer.accessibility')` through a local
`Translate` type rather than `useTranslations`, which the parser could not see — that alone
cut fascia's false positives from 27 keys to 15.

**One real finding to action when this is revisited:** `common.cancel` in fascia's catalog
is genuinely dead.

**Note:** `--only` does *not* suppress the undefined check. Passing `--unused` always runs
both. The script stays out of `check:all` for that reason.

## Smaller items

- **`madge` cannot resolve workspace imports.** `pnpm circular` skips 43 of 188 files
  because no tsconfig declares `paths` for `@artloupe/*` (`@/*` is per-app,
  `tsconfig.base.json` has none). Cycles *within* a package are still caught, and
  dependency-cruiser already enforces the cross-package rules, so this is a partial gap
  rather than a hole. Closing it means a madge-specific tsconfig.
- **Dead `size-limit` config at the repo root.** Root `size` now delegates to the per-app
  configs, so the root `size-limit` array in `package.json` is unused. Either delete it or
  give it its own script name as a deliberate cross-app aggregate.
- **`size-limit` entries are named "JS (First Load)" but glob every chunk.** The number is
  total route JS, not first-load, so it overstates what any single route ships.
- **The 300 kB JS budget now has ~50 kB of slack.** All three apps sit at 242–248 kB since
  the Zod client leak was fixed. Tightening to roughly 260 kB would make the next accidental
  server-only import fail loudly instead of quietly consuming headroom — the 92 kB leak fit
  inside the current budget's slack twice over. Worth deciding before the apps grow.
