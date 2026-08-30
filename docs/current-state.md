# Current state

**Updated:** 2026-08-30

## 1. Snapshot

Art Loupe is at its **initial scaffold**, and the repository's git history was reset on
2026-08-30: the inherited history is gone, `.git` was re-initialised, and everything is
staged as one initial commit that has **not yet been made or pushed**. The prior history is
bundled outside the repo. The scaffold itself was seeded from prior monorepo infrastructure
and stripped — see [ADR 0001](./decision-records/0001-scaffolded-from-existing-monorepo.md).

### What works today

- **Three apps run and build**: `entry` (3003), `studio` (3001), `operations` (3000).
- **The click-through flow works end to end**: entry → acknowledge → launch → sign in.
  Studio uses Supabase email/password; operations uses env credentials.
- **All quality checks are green** — format, lint, CSS, markdown, i18n parity, traceability,
  contrast, typecheck, unit tests, dependency rules, and the Python toolchain (ruff +
  12 pytest), each enforced in CI.

### Changed this session

- **`docs/design/` is now `docs/contrast-report/`** and carries a hand-written `README.md`.
  The folder holds only generated output. `media-assets.md` moved up to `docs/`.
- **`README.md` gained five sections** — Prerequisites, Optional command-line tools,
  Generated reports, Prose (Vale), and Agent skills.
- **Node is pinned in `.nvmrc` (24)** and all five CI `setup-node` steps read it via
  `node-version-file`, so the version lives in exactly one place.
- **Vale prose linting** (`pnpm lint:prose`) is wired but **advisory** — deliberately outside
  `check:all`. The cleanup is unfinished and the package set is still being evaluated.
- **Dangling citations removed repo-wide.** `ui-shell-spec` Q-numbers (71 sites) and
  predecessor issue numbers (41 sites) are gone; the explanations they annotated stay.
- **WebKit e2e was failing on a real defect.** `next build` bakes `headers()` into
  `routes-manifest.json`, so `DISABLE_HTTPS_UPGRADE` on the served process did nothing —
  WebKit upgraded every asset to `https://localhost` and rendered the page unstyled, which
  axe correctly reported as a target-size failure. Fixed in all three Playwright configs.
- **`apps/entry` shipped Zod to the browser.** A client component imported one const from
  `app-origins.ts`, which imports `@/env`. Splitting the constants into an import-free
  `launch-targets.ts` cut the bundle 334 kB → 248 kB.
- **New static checks repaired** — `circular` (madge) had never run, `depcruise:graph`
  rendered empty, `size` aggregated all three apps into one figure, and
  `i18n:check:unused` aborted the whole run on its first failure.
- **Demo credentials standardised.** The seed script now defaults to `demo-artist-pass`
  (artist) and `demo-operator-pass` (operator) as two separate values, and the README
  documents both. Existing local accounts were deleted and re-seeded to match.
- **Session metrics restart from zero.** Every prior record went with the strip.

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

- **Backlog = GitHub issues.** `backlog-report.mjs`, the `backlog` skill, and
  `.github/ISSUE_TEMPLATE/` are in place. **Not live yet** — it needs the repo pushed and a
  user-owned Project created, so until then a deferral gets raised in conversation.

### Open questions

- **Operations role.** The ops proxy allows `operator` + `superuser`, but demo logins
  resolve to `superuser`, so `operator` is currently decorative.
- **Spanish copy** was machine-drafted for the scaffold's handful of strings and has not
  been reviewed by a speaker.
- **Traceability flows are a plan, not a record.** Seven of ten flows have no test yet;
  they were drafted ahead of the features and should be corrected as the real shape emerges.
- **Should the three Art Loupe session records deleted in the strip be restored** from the
  bundle? Cleaner before the initial commit than after.
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

**State:** scaffold only, no product features. Fresh `git init` on `main`, **zero commits**,
~334 files staged, no remote. History reset deliberate; old history bundled outside the repo.
Deferred work that has no board to live on yet is in [`docs/backlog.md`](./backlog.md).

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

**Next step:** commit the staged tree, reinstall husky (`pnpm exec husky` — `rm -rf .git`
destroyed the local `core.hooksPath`, so hooks are silent until it runs), then
`gh repo create lsr-explore/art-loupe --private --source=. --remote=origin --push`. Create
the project board after, which unblocks the `backlog` skill. Then decide the first workflow
to build — critique studio is the obvious anchor.

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
