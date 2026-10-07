# 0005 — Oxfmt replaces Biome as the formatter

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** Laurie Reynolds

## Context

[ADR 0004](0004-oxlint-replaces-eslint-and-biome-linting.md) made Oxlint the only linter. It kept
Biome for formatting and import sorting only. That deferral was a matter of caution, not
necessity. With Biome's linter off, Biome's only job was formatting, so a second toolchain
remained installed and configured for that one task.

## Decision

1. **Oxfmt is the only formatter.** Its configuration is `.oxfmtrc.jsonc`. `pnpm format` and
   `pnpm format:check` run it, and lint-staged runs it on staged files.
2. **The configuration reproduces Biome's behaviour.** It started from
   `oxfmt --migrate=biome`. Three settings were then added, so the switch changes formatting
   style and nothing else:
   - `sortImports` is on, because `biome check` sorted imports.
   - `sortPackageJson` is off, because Biome never reordered `package.json` keys.
   - CSS keeps double quotes, because Biome did and `singleQuote` would otherwise apply.
3. **The scope matches Biome's.** Markdown, YAML, TOML, HTML and `scripts/**` stay unformatted.
   Biome never formatted them, and other tools own Markdown (markdownlint). Widening the scope
   is a separate decision.
4. **Biome is removed:** the `@biomejs/biome` dependency and `biome.json`.

## Rationale

- One toolchain. Oxc now provides both the linter and the formatter.
- Oxfmt follows Prettier's output. If Oxfmt stalls, Prettier is a near drop-in replacement. If
  Biome had stalled, the move would have been a reformat.
- The usual reasons to wait did not apply. Oxfmt is pre-1.0 (0.72), but Prettier compatibility
  bounds the risk, and the reformat is one mechanical change.

## Alternatives considered

- **Keep Biome as the formatter (ADR 0004's position).** Stable and already in place, but it
  keeps a second toolchain for one job.
- **Prettier.** The reference implementation of the same style, but slower, and a third vendor
  next to Oxc.

## Consequences

- **A one-time reformat.** Ignoring whitespace, the reformat touched about 250 lines. Most of
  the visible churn is re-indentation of Playwright `test.describe(..., { annotation }, ...)`
  calls, which Prettier's style lays out differently from Biome's, plus import reordering
  under Oxfmt's sorting algorithm.
- **No `.git-blame-ignore-revs` entry yet.** PRs are squash-merged, so the reformat's own SHA
  does not survive. The entry, if wanted, is the squash commit's SHA on `main`, added after
  the merge.
- **Editors format on save with Oxfmt.** `.vscode/settings.json` sets the Oxc extension
  (`oxc.oxc-vscode`) as the formatter for the file types Oxfmt owns here, and nothing else.
  The extension runs the project's own `oxfmt --lsp` and also surfaces Oxlint.
  `.vscode/extensions.json` recommends it, and marks Biome, ESLint and Prettier as unwanted.
- **Generated JSON reports must stay formatter-canonical.** The report generators format
  their output *before* it is committed, so their shape must still match the formatter's
  output.

## Related

- [ADR 0004](0004-oxlint-replaces-eslint-and-biome-linting.md): Oxlint as the only linter.
- `.oxfmtrc.jsonc`: the configuration, with the reason for each non-default setting.
