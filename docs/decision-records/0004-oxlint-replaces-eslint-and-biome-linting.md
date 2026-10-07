# 0004 — Oxlint replaces ESLint and Biome's linter; Biome keeps formatting

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** Laurie Reynolds

## Context

The repository ran two linters. Biome linted general JavaScript and TypeScript, and ESLint ran
the rules Biome could not: `eslint-plugin-jsx-a11y`, `eslint-config-next` (with
`eslint-plugin-react-hooks` 7), and two house rules, `id-length` and `func-style`.
`eslint-config-biome` switched off the 557 ESLint rules Biome implements, and the jsx-a11y rules
had to be re-applied after it. Accessibility enforcement depended on that ordering, which
`settled-decisions.md` recorded.

Two problems made the split worth revisiting:

1. **TypeScript 7 cannot run ESLint at all.** `typescript-eslint` 8.71 accepts
   `typescript >=4.8.4 <6.1.0` and throws while loading under 7.0
   ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)).
   `eslint-config-next` imports it, so the whole configuration fails to load. Every rule stops,
   including the accessibility rules, not only the TypeScript ones.
2. **Two linters with overlapping rule sets.** Biome's and ESLint's versions of the same rule
   disagree at the edges. For example, ESLint flags `<ul role="list">` as redundant and Biome
   does not. Keeping them aligned needs a third package and an ordering trick.

## What was measured first

Coverage was measured against Oxlint 1.87.0's own rule list (`oxlint --rules --format=json`),
not against documentation:

| What ESLint enforced | Oxlint native | Gap |
| --- | --- | --- |
| jsx-a11y recommended (31 rules) | 31 | none |
| `eslint-plugin-react-hooks` 7 recommended (17 rules) | 15 | `config`, `gating`: React Compiler options this repo does not set |
| `@next/next` core-web-vitals (22 rules) | 21 | `no-location-assign-relative-destination` |
| `id-length`, `func-style` | both | none |
| `eslint-config-next/typescript` (non-type-aware) | all | none |

A first pass against summarized documentation had listed five jsx-a11y rules as missing. The
CLI showed all 31 present. The rule list, not the docs, is the source for any future audit.

## Decision

1. **Oxlint is the only JavaScript and TypeScript linter.** Its configuration is
   `.oxlintrc.jsonc`, and `pnpm lint` runs it.
2. **Native rules first; ESLint plugins only for gaps.** The one rule with no native port,
   `no-location-assign-relative-destination`, runs from `@next/eslint-plugin-next` through
   Oxlint's JS plugin API, aliased as `next-js` because `nextjs` is a native plugin name.
3. **Biome formats and sorts imports; its linter is off.** `pnpm format` and
   `pnpm format:check` are unchanged.
4. **`correctness` is the baseline category**, replacing Biome's recommended set. Rules outside
   it that matter are named explicitly. In particular, `react/rules-of-hooks` sits in Oxlint's
   `pedantic` category and would otherwise be silently lost.
5. **Accessibility is enforced by Oxlint's jsx-a11y rules**: all 31 recommended rules, plus
   `prefer-tag-over-role`, which Oxlint enables through `correctness`. This replaces the
   jsx-a11y entry in `settled-decisions.md`.

## Rationale

- **One linter, one configuration.** No `eslint-config-biome`, no ordering dependency, and no
  disagreement between two implementations of the same rule.
- **The React Compiler rules survive.** `refs`, `purity`, `set-state-in-effect`,
  `immutability` and the rest run natively. A Biome-only setup would have kept two of the
  seventeen.
- **No `typescript-eslint` dependency.** Oxc parses the code itself. None of the ESLint
  plugins kept or considered depend on TypeScript. This removes the TypeScript 7 lint blocker,
  and Oxlint's type-aware path (`tsgolint`, on typescript-go) requires TypeScript 7.
- **Stewardship.** Oxc is maintained by VoidZero, which Cloudflare acquired on 2026-06-04, with
  a commitment that Vite, Vitest, Rolldown and Oxc stay MIT-licensed and vendor-neutral. This
  repo already depends on Vitest from the same toolchain.

## Alternatives considered

- **Keep ESLint and Biome, alias TypeScript 6 for ESLint.** Microsoft's side-by-side setup
  (`typescript` aliased to `@typescript/typescript6`, `@typescript/native` for TS 7) works.
  Rejected as the end state: it keeps both linters and their overlap, and leaves lint on the
  TypeScript 6 API indefinitely.
- **Biome as the only linter.** Rejected. Biome has no React Compiler rules beyond
  `rules-of-hooks` and `exhaustive-deps`, no `id-length` or `func-style`, and few Next.js rules.
  Its accessibility rules also behave differently from jsx-a11y's.
- **Load every ESLint plugin through Oxlint's JS plugin API.** Closest to the previous rule
  implementations, but every rule would depend on an alpha API and run in JavaScript. Rejected
  in favour of native rules with a JS plugin only where a gap exists.
- **Oxfmt for formatting as well.** Deferred. Oxfmt is pre-1.0 (0.72), and its
  Prettier-compatible output would reformat most of the repository. Biome's formatter is stable
  and already in place.

## Consequences

- **Findings ESLint never raised.** The migration fixed them rather than suppressing them:
  - Three unused variables and five small simplifications in `scripts/reports/`.
  - A zero-width space hidden in a comment in `nav-link.tsx`.
  - Single-letter type parameters. `id-length` now checks type parameters, which ESLint did
    not, so `<T>` and `<K>` became `<Item>`, `<Value>` and `<Key>`.
- **`prefer-tag-over-role` changed markup.** The inspiration status line is now `<output>`. It
  keeps `aria-live="polite"` and `aria-atomic="true"`, because `<output>` alone is announced
  unevenly. The theme toggle and the overlay layer are now `<fieldset>` elements, with margin,
  padding and min-width reset. Both keep their implicit `group` role, so role-based tests are
  unchanged.
- **One accessibility rule reads more widely.** Oxlint's `no-noninteractive-element-interactions`
  counts drag handlers, and ESLint's did not. The photograph drop zone's `<label>` carries a
  single-line suppression with its reason: drag is a pointer-only enhancement, and the file
  input inside the label is the keyboard and screen-reader path.
- **Vitest idioms the Jest-derived rules misread are switched off.** These are `valid-expect`
  (Vitest's `expect(value, message)`), `require-to-throw-message` (on `.not.toThrow()`),
  `valid-title` (computed `it.each` titles), `no-conditional-expect` (type-narrowing guards)
  and `require-mock-type-parameters`. Each has a comment in `.oxlintrc.jsonc`.
- **Globals must be declared.** `env` lists `browser` and `node`. Without `browser`, the Next.js
  JS plugin cannot resolve `window` as a global, and its rule silently never fires.
- **The configuration is `.oxlintrc.jsonc`, not `.json`.** It carries comments, which Oxlint
  accepts. A strict JSON parser rejects them, and Biome's editor integration reported them as
  errors. The `.jsonc` extension says what the file is, and Oxlint discovers it without a flag.
- **Suppression comments use Oxlint's names**, such as `oxlint-disable-next-line
  nextjs/no-img-element`. `biome-ignore` comments for lint rules are gone.
- **The JS plugin API is alpha.** One rule depends on it. If it breaks, that rule can be
  dropped without affecting the rest.

## Open follow-ups

- **TypeScript 7.** The lint blocker is gone. Next.js's own use of `typescript` during
  `next build`, and the Dependabot hold on TypeScript majors, still need their own evaluation.
- **Re-audit coverage on Oxlint upgrades.** Re-run the measurement above, from the CLI's rule
  list, when Oxlint adds React Compiler options or the missing Next.js rule natively.

## Related

- `.oxlintrc.jsonc` — the configuration, with the reason for every non-default setting.
- `docs/decision-records/settled-decisions.md` — the accessibility enforcement entry.
- [ADR 0001](0001-scaffolded-from-existing-monorepo.md) — the toolchain this repo started with.
