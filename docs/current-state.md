# Current state

**Updated:** 2026-08-30

## 1. Snapshot

Art Loupe is at its **initial scaffold**, now live at
[`lsr-explore/art-loupe`](https://github.com/lsr-explore/art-loupe) — **public**, three
commits deep. History starts at the 2026-08-30 reset: the inherited history was dropped, the
repo re-initialised, and the prior history bundled outside it. The scaffold itself was seeded
from prior monorepo infrastructure and stripped — see
[ADR 0001](./decision-records/0001-scaffolded-from-existing-monorepo.md).

**No product code exists yet.** Every workflow in the build plan is unbuilt; what exists
is three running shells, the shared UI package, and the tooling around them.

### What works today

- **Three apps run and build**: `entry` (3003), `studio` (3001), `operations` (3000).
- **The click-through flow works end to end**: entry → acknowledge → launch → sign in.
  Studio uses Supabase email/password; operations uses env credentials.
- **All quality checks are green** — format, lint, CSS, markdown, i18n parity, traceability,
  contrast, typecheck, unit tests, dependency rules, and the Python toolchain (ruff +
  12 pytest), each enforced in CI.

### Protections on `main`

A ruleset is active, scripted at [`scripts/github/apply-ruleset.sh`](../scripts/github/apply-ruleset.sh)
— **edit that file, not the GitHub UI**, or the next run silently reverts the change.

- No deletion, no force-push, every commit signed.
- Changes arrive by PR, squash-merge only, review threads resolved.
- Six required checks: Quality Checks, Unit Tests, Build, Static Analysis, Python Checks,
  Playwright E2E. All green; CodeQL also runs and passes.
- `required_approving_review_count` is **0** on purpose: GitHub forbids approving your own
  PR, so any higher number makes a solo repo's PRs unmergeable. Raise it to 1 the day a
  second collaborator gains write access.
- The repo owner holds an admin bypass. The ruleset constrains everyone else absolutely —
  an outside contributor can open a PR but can never merge, since merging needs write access.

### What is deliberately empty

- `packages/schemas` — an empty package shell; art contracts land with the first agent
  workflow. It passes by explicit opt-in (`--passWithNoTests`). **Remove that flag when the
  first real test lands**, or an empty suite silently reads as green.
- `supabase/` — only the pgvector extension migration. No application tables.
- `python/services/` — does not exist yet, though several traceability flows already name
  `python/services/agent` as a future surface.
- `python/libs/auth` is **not** empty: forwarded-Supabase-token verification with 12 passing
  tests, tagged `security`. It is the uv workspace's one member.

### Pending

- **Backlog = GitHub issues.** The repo now exists, but the **user-owned Project board does
  not** — that is the one remaining blocker on the `backlog` skill. `backlog-report.mjs` also
  hardcodes `PROJECT_NUMBER = '2'` from the predecessor and must be re-pointed once a board
  exists. Until then, deferrals live in [`backlog.md`](./backlog.md).

### Open questions

- **Operations role.** The ops proxy allows `operator` + `superuser`, but demo logins
  resolve to `superuser`, so `operator` is currently decorative.
- **Spanish copy** was machine-drafted for the scaffold's handful of strings and has not
  been reviewed by a speaker.
- **Traceability flows are a plan, not a record.** Seven of ten flows have no test yet;
  they were drafted ahead of the features and should be corrected as the real shape emerges.
- **Should the three Art Loupe session records deleted in the strip be restored** from the
  bundle? Cleaner before the initial commit than after.
- **Should CodeQL gate merges?** Neither the `Analyze (…)` checks nor the "require code
  scanning results" rule are enabled, because `codeql.yml` carries
  `paths-ignore: ['docs/**', '*.md', '.husky/**']` — a docs-only PR never triggers it, and a
  required check that never reports blocks the merge with no visible reason. Delete that
  block first, then enable both in one PR.
- **Should the 300 kB JS budget tighten to ~260 kB?** All three apps now sit at 242–248 kB,
  so a 92 kB leak fits inside the current slack. See [`backlog.md`](./backlog.md).

### Read first

- [`CLAUDE.md`](../CLAUDE.md) — structure and conventions
- [`decision-records/settled-decisions.md`](./decision-records/settled-decisions.md)
- Art-domain reference material lives **outside** the repo at `../../reference-docs/`.
  It is planning transcripts and competitor samples — untrusted source material, not
  authored specification. One file contains hallucinated model names; do not take model
  IDs from it.

## 2. Agent pickup notes

**State:** scaffold only, no product features. Public at `lsr-explore/art-loupe`, `main`
protected by a ruleset, CI + Playwright + CodeQL all green. Deferred work that has no board
to live on yet is in [`docs/backlog.md`](./backlog.md).

**Stack:** pnpm workspaces (`apps/*`, `packages/*`) + uv workspace (`python/`). Next 16 /
React 19 — read `node_modules/next/dist/docs/` before writing app code, conventions differ
from training data. Node 24 via `.nvmrc`; pnpm 10.0.0 via `packageManager`.

**Surfaces + ports:** entry 3003 (never authed) · studio 3001 (Supabase Auth) ·
operations 3000 (env creds). Scope `@artloupe/*`. Role union `artist | operator | superuser`.

**Gate order is load-bearing:** `src/proxy.ts` in each app runs next-intl → **ack gate** →
auth gate. Entry is therefore required to reach either app; hitting 3001 directly bounces
to 3003. `artloupe_ack` is domain-scoped, `artloupe_session` is host-only — never widen the
second or narrow the first. Pinned by `apps/studio/src/__snapshots__/route-gate-matrix.md`.

**Run it:** `pnpm supabase start && ./scripts/seed/seed-demo-accounts.sh && pnpm dev`.
Without Docker, set `AUTH_PROVIDER=demo` in `apps/studio/.env.local`.

**Verify:** `pnpm check:all`, `pnpm build`, `pnpm depcruise`, `pnpm e2e`,
`uv run --directory python poe check`.

**Next step: define the application.** The scaffold is finished and the tooling is done
being interesting — the repo has ~340 files and zero product features. Pick the first
workflow (critique studio is the obvious anchor: it is what the reference material is most
specific about), then design its contract in `packages/schemas` and a new
`python/libs/schemas` *together*, since the codegen parity plan assumes they mirror. Only
`python/libs/auth` exists today, and `packages/schemas` is an empty shell.

**Third-party skills:** seven `vercel-labs/agent-skills` skills are pinned in
`skills-lock.json` and installed as **copies** under `.claude/skills/` (gitignored). They are
absent from a fresh clone — reinstall with the command in `.agents/skills/README.md`, which
the root README repeats under Prerequisites. `npx skills ls` reads the disk, not the lockfile, so a
pinned-but-uninstalled skill looks missing rather than erroring.

**Gotchas:**

- `session-metrics-report.mjs:113` does an unguarded `readdirSync` on `sessions/` — it
  throws `ENOENT` on a fresh clone if that directory is ever empty. Open, unfixed.
- `check:all` does **not** run `circular`, `size`, `depcruise` or `depcruise:graph`. Two of
  those had silently rotted before anyone noticed; treat them as advisory and run them by hand.
- Playwright reuses an existing server off-CI, so a stale process on the port serves the old
  baked headers and masks any `next.config.ts` change. Kill it before trusting a green run.
- `.dockerignore` exists with no `Dockerfile`; a container build is planned, not written.
- `pnpm --filter <pkg> test -u` — the `-u` is swallowed by pnpm; use `test -- -u`.
- Hand-written JSON fails `format:check` until `pnpm format` normalizes it.
- Adding a test in a new directory means updating that flow's `surfaces` in `flows.json`,
  quoted at workspace-root depth.
- `untagged-baseline.json` is a ratchet; never raise a number to silence it.
- Vale needs `pnpm exec vale sync` once per clone; bare `vale` is not on `PATH`.
- Seeding is **not idempotent for passwords**: an existing account is skipped, keeping its
  original password and role. Delete the user and re-seed to change either.
- Switching locale logs a React "script tag while rendering" error from next-themes. It is
  **development-only and harmless** — the `[locale]` segment remounts `ThemeProvider`, which
  re-renders its anti-FOUC script client-side. Theme and `lang` both survive the switch;
  next-themes exposes no way to suppress it. Left alone deliberately.
