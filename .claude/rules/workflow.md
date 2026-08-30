# Workflow Preferences

## Git and commits

- Do not commit changes unless explicitly asked.
- Do not push to a remote unless explicitly asked.
- Use conventional commit style: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`.
- Husky pre-commit runs `pnpm format:check && pnpm lint && pnpm typecheck`. Do not bypass with `--no-verify` unless explicitly asked.

### Committing, PRs, and the review loop → the `ship` skill

When asked to commit, push, or open a PR — and **automatically once a branch is pushed and a
PR is open** — invoke the **`ship`** skill and follow it through review rather than ending
the turn at "PR is up." It carries the procedure: pre-push checks, conventional commit, PR,
bounded CI watch, a Greptile review once the branch is final, dispositioning, and hand-off.
Reviews are **not** automatic — intermediate commits are free; the review is spent once.

**Laurie merges — you never do** (squash; rebase breaks SSH signatures). Resume for the
post-merge wrap-up when she says it's merged.

### Deferrals → GitHub issues, via the `backlog` skill

Deferred work is tracked as **GitHub issues** on a user-owned project board — that is the
source of truth, and `docs/backlog/` is a generated map of it. Filing is not finished when
`gh issue create` returns: the issue also needs a board entry with a Priority and a real
sub-issue link to its epic. The **`backlog`** skill carries that procedure; use it rather
than filing by hand.

**Not live yet.** This needs the GitHub repo and its project board to exist. Until the repo
is pushed there is nowhere to file, so raise the deferral in conversation and let Laurie
decide whether it earns an issue once the board is up.

## Commands

- Proceed without asking when running normal project scripts such as `pnpm test`, `pnpm lint`, `pnpm build`, and similar safe verification commands.
- Ask before running `pnpm install`, `pnpm add`, or other dependency-changing commands.
- Ask before running destructive, network-heavy, or environment-altering commands.
- **Don't `cd` into the repo** — the shell's working directory persists across commands and starts at the repo root.
- **Prefer the repo's package.json scripts** over ad-hoc tool invocations, and pass extra args *through* the script (`pnpm --filter @artloupe/studio e2e --project=chromium`), not via `pnpm … exec …` (which runs arbitrary binaries and stays off the allowlist).
- The committed `.claude/settings.json` allowlists scoped `pnpm --filter * <script>` patterns so verification scripts don't prompt; `exec` / `add` / `dlx` / `install` deliberately still prompt.
- Per-app interactive Playwright runner: `pnpm e2e:ui:<app>` (or `pnpm --filter @artloupe/<app> e2e:ui`) — interactive/blocking, so run it in its own terminal, not via the agent.

## Change strategy

- Read relevant files before editing.
- Prefer the smallest safe change that satisfies the request.
- Avoid broad refactors unless explicitly requested.
- Run appropriate quality checks after making changes.

## Documentation discipline

- When an architectural decision is made, capture it as a new ADR in `docs/decision-records/` (numbered, e.g. `0003-…md`).
- Record session outcomes via the `/wrap` skill: a metrics record in `docs/session-metrics-reports/sessions/` plus the living `docs/current-state.md`. See `.claude/rules/current-state.md`.
