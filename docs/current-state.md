# Current state

**Updated:** 2026-08-30

## 1. Snapshot

Art Loupe is at its **initial scaffold**, live at
[`lsr-explore/art-loupe`](https://github.com/lsr-explore/art-loupe) — **public**, eight
commits deep. History starts at the 2026-08-30 reset: the inherited history was dropped, the
repo re-initialised, and the prior history bundled outside it. The scaffold was seeded from
prior monorepo infrastructure and stripped — see
[ADR 0001](./decision-records/0001-scaffolded-from-existing-monorepo.md).

**No product code exists yet.** What exists is three running shells, the shared UI package,
and the tooling around them.

### The application is now being defined

The capstone has pivoted to Art Loupe as its **final** scope, and a proposal is on the table
awaiting decisions. Written up in `docs/temp-references/art-loupe-proposal.md` — **gitignored
and transient**, to be replaced by `docs/design/` and an ADR once settled.

- **Wedge:** a reference photograph becomes a medium-aware, time-boxed working plan, where
  every claim is one of exactly three things — **measured** (a pixel fact), **cited** (an
  instructional source), or **chosen** (an explicit artistic call). The system never
  generates or alters imagery.
- **Two feature-bearing apps:** `studio` (the artist) and `operations` (traces, cost,
  grounding, safety, evals). `entry` stays as the built public shell and never grows a
  workflow.
- **In-progress artwork critique is cut** — credible work-in-progress images cannot be
  supplied. Its value folds into reference assessment at intake, a hand-applied self-check
  card, and the **Plan Critic**, which critiques the *plan* and survives the cut.
- **Five agents:** Studio Director, Visual Analyst, Art Tutor, Studio Planner, Plan Critic.
  Everything else is a tool or a service and the docs must say so.
- **Undecided, blocking the design docs:** the showcase vision tool, the Week 9 fine-tuning
  story, and whether voice is in scope. See §15 of the proposal.

### What works today

- **Three apps run and build**: `entry` (3003), `studio` (3001), `operations` (3000).
- **The click-through flow works end to end**: entry → acknowledge → launch → sign in.
- **All quality checks are green in CI** — format, lint, CSS, markdown, i18n parity,
  traceability, contrast, typecheck, unit tests, dependency rules, ruff + 12 pytest.
  Locally, `lint:md` fails on the disposable `docs/temp-references/` files; ignore it.

### Protections on `main`

A ruleset is active, scripted at [`scripts/github/apply-ruleset.sh`](../scripts/github/apply-ruleset.sh)
— **edit that file, not the GitHub UI**, or the next run silently reverts the change.

- No deletion, no force-push, every commit signed; PR-only, squash-merge, threads resolved.
- Six required checks: Quality Checks, Unit Tests, Build, Static Analysis, Python Checks,
  Playwright E2E. CodeQL now runs without `paths-ignore` and its `Analyze` jobs are required.
- `required_approving_review_count` is **0** on purpose: GitHub forbids approving your own
  PR, so any higher number makes a solo repo's PRs unmergeable. Raise it to 1 the day a
  second collaborator gains write access.
- The repo owner holds an admin bypass; the ruleset constrains everyone else absolutely.

### What is deliberately empty

- `packages/schemas` — an empty shell; art contracts land with the first agent workflow. It
  passes via `--passWithNoTests`. **Remove that flag when the first real test lands.**
- `supabase/` — only the pgvector extension migration. No application tables, no RLS.
- `python/services/` — does not exist yet, though traceability flows already name
  `python/services/agent` as a future surface.
- `python/libs/auth` is **not** empty: forwarded-Supabase-token verification, 12 passing
  tests tagged `security`. It is the uv workspace's one member.
- No LangGraph, LangChain, OpenAI, or Anthropic dependency exists anywhere in the repo.

### Backlog

Live on [`art-loupe-backlog`](https://github.com/users/lsr-explore/projects/3) (user project
**3**). Eight open issues: one epic, `#5 quality: static-analysis and prose-tooling
follow-ups`, with six children, plus `#12 auth: magic-link`. Generated map:
[`backlog/issues.md`](./backlog/issues.md).

**Label convention:** `enhancement` is reserved for **product features**. Chores use
`tooling`, defects `bug`, docs-only `documentation`, parents `epic`. Priority and Status are
project fields — there are no priority labels. Area grouping comes from a `prefix:` on the
issue **title**.

### Open questions

- **The three §15 scope decisions** — showcase tool, Week 9, voice. Everything in
  `docs/design/` waits on these.
- **`flows.json` still encodes the cut scope**: `critique.formal-analysis`,
  `critique.alignment`, `critique.no-generation`, `canvas.session-plan`. Seven of ten flows
  have no test, so restructuring is cheap now. Proposal: keep `retrieval.grounding`, rename
  `critique.no-generation` → `safety.no-generation`, replace the rest with `plan.*` /
  `analysis.*`.
- **`settled-decisions.md` defines Art Loupe as including critique** — needs amending, as a
  ledger entry rather than a silent edit, alongside a new **ADR 0003** for the scope commitment.
- **`backlog/critical-path.md` is stale** — traced against `6aedc9d`, a commit not in this
  repo's history. Rewrite or delete.
- **Operations role.** The ops proxy allows `operator` + `superuser`, but demo logins resolve
  to `superuser`, so `operator` is decorative.
- **Spanish copy** was machine-drafted and has not been reviewed by a speaker.
- **Should the 300 kB JS budget tighten to ~260 kB?** All three apps sit at 242–248 kB.

### Read first

- [`CLAUDE.md`](../CLAUDE.md) — structure and conventions
- [`decision-records/settled-decisions.md`](./decision-records/settled-decisions.md)
- `docs/temp-references/art-loupe-proposal.md` — the pending scope proposal (gitignored)
- Art-domain reference material lives **outside** the repo at `../../reference-docs/`. It is
  planning transcripts and competitor samples — untrusted source material, not authored
  specification. One file contains hallucinated model names; do not take model IDs from it.

## 2. Agent pickup notes

**State:** scaffold only, no product features. Public at `lsr-explore/art-loupe`, `main`
ruleset-protected, CI + Playwright + CodeQL green. Backlog is GitHub issues on user project 3.

**Scope is pivoting and it is final.** Art Loupe = reference photo → medium-aware working
plan. Never generates imagery. Artwork critique is **cut**; the **Plan Critic** (evaluator
over the plan) is **kept** — do not conflate them. Sibling `../../veloce-trace/` is the prior
clinical capstone: a pattern source to port from, not a project to return to.

**Stack:** pnpm workspaces (`apps/*`, `packages/*`) + uv workspace (`python/`). Next 16 /
React 19 — read `node_modules/next/dist/docs/` before writing app code. Node 24 via `.nvmrc`;
pnpm 10.0.0.

**Surfaces + ports:** entry 3003 (never authed) · studio 3001 (Supabase Auth) ·
operations 3000 (env creds). Scope `@artloupe/*`. Roles `artist | operator | superuser`.

**Gate order is load-bearing:** `src/proxy.ts` in each app runs next-intl → **ack gate** →
auth gate. Entry is required to reach either app. `artloupe_ack` is domain-scoped,
`artloupe_session` host-only — never widen the second or narrow the first. Pinned by
`apps/studio/src/__snapshots__/route-gate-matrix.md`.

**Run it:** `pnpm supabase start && ./scripts/seed/seed-demo-accounts.sh && pnpm dev`.
Without Docker, set `AUTH_PROVIDER=demo` in `apps/studio/.env.local`.

**Verify:** `pnpm check:all`, `pnpm build`, `pnpm depcruise`, `pnpm e2e`,
`uv run --directory python poe check`.

**Next step: get the three §15 answers, then write the design docs.** Read
`docs/temp-references/art-loupe-proposal.md` first — it is the whole brief. Once the showcase
tool, Week 9 story, and voice question are settled: write **ADR 0003** (scope commitment +
the non-generative invariant as an architectural constraint), amend `settled-decisions.md`,
then `docs/design/` in dependency order — `requirements.md`, `agents.md`, `architecture.md`,
`sla-targets.md`, `rubrics.md`, `learning_mapping.md`, `demos.md`, `e2e-walkthrough.md`.
**Only then** the first build slice: `packages/schemas` and a new `python/libs/schemas`
designed *together*, since the codegen parity plan assumes they mirror.

**Third-party skills:** seven `vercel-labs/agent-skills` skills are pinned in
`skills-lock.json` and installed as **copies** under `.claude/skills/` (gitignored). Absent
from a fresh clone — reinstall with the command in `.agents/skills/README.md`. `npx skills ls`
reads the disk, not the lockfile, so a pinned-but-uninstalled skill looks missing.

**Gotchas:**

- `docs/temp-references/` is gitignored but markdownlint still walks it, so `pnpm lint:md`
  and `check:all` fail **locally** while CI is green. Deliberate — the folder is disposable.
- `session-metrics-report.mjs:113` does an unguarded `readdirSync` on `sessions/` — throws
  `ENOENT` on a fresh clone if that directory is empty. Open, unfixed.
- `check:all` does **not** run `circular`, `size`, `depcruise` or `depcruise:graph`. Two had
  silently rotted before anyone noticed; run them by hand.
- Playwright reuses an existing server off-CI, so a stale process serves old baked headers and
  masks a `next.config.ts` change. Kill it before trusting a green run.
- `.dockerignore` exists with no `Dockerfile`; a container build is planned, not written.
- `pnpm --filter <pkg> test -u` — the `-u` is swallowed by pnpm; use `test -- -u`.
- Hand-written JSON fails `format:check` until `pnpm format` normalizes it.
- Adding a test in a new directory means updating that flow's `surfaces` in `flows.json`,
  quoted at workspace-root depth. `untagged-baseline.json` is a ratchet.
- Vale needs `pnpm exec vale sync` once per clone; bare `vale` is not on `PATH`.
- Seeding is **not idempotent for passwords**: an existing account is skipped, keeping its
  original password and role. Delete the user and re-seed to change either.
- Switching locale logs a React "script tag while rendering" error from next-themes.
  **Development-only and harmless** — the `[locale]` segment remounts `ThemeProvider`, which
  re-renders its anti-FOUC script client-side. Left alone deliberately.
