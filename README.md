# Art Loupe

**Structured critique and studio planning for working artists — grounded in
art-historical sources, never in generated imagery.**

Art Loupe is a multi-agent **Artist's Studio Director**: an artist-facing studio that
analyses work the artist supplies and returns formal analysis, alignment critique
against the artist's own stated goal, palette and value studies, and session plans —
each claim carried back to a citation.

> **The system never generates imagery.** It reasons about work the artist made. That
> is a design commitment, not a limitation: it keeps the tool on the right side of
> authorship and copyright, and it is what makes the critique worth reading.

⚠️ **Educational demonstration only.** Art Loupe is a portfolio/capstone demo. It is not
a valuation, authentication, or legal service. See [`NOTICE`](./NOTICE).

> Domain: `artloupestudio.com` · package scope: `@artloupe/*`. This README documents a
> **work in progress**; the repository is currently an initial scaffold.

## Table of contents

- [What it is](#what-it-is)
- [Surfaces](#surfaces)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Quality](#quality)
- [Generated reports](#generated-reports)
- [Test traceability](#test-traceability)
- [Documentation](#documentation)
- [License](#license)

## What it is

The planned workflows, in the order they are being built:

| Workflow | What it does |
| --- | --- |
| **Critique studio** | Formal structural analysis, then a critique of whether execution matches the artist's *stated goal*, then academic/historical context via retrieval. |
| **Value & palette studies** | Deterministic CV — K-means quantisation for dominant and accent colours, grayscale/Notan value studies, Canny/Sobel edge maps. No inpainting, no generation. |
| **Session planner** | Aspect-ratio match to a physical canvas, compositional grid overlays, and a printable studio prep kit. |
| **Operations** | Cost and latency per agent, prompt version management, evaluation health. |

## Surfaces

| App | Dev | Production | Auth |
| --- | --- | --- | --- |
| `apps/entry` | `localhost:3003` | `artloupestudio.com` | never authenticated |
| `apps/studio` | `localhost:3001` | `studio.artloupestudio.com` | Supabase email/password |
| `apps/operations` | `localhost:3000` | `ops.artloupestudio.com` | env credentials |

The entry point is the only surface that lists the others, so it is the whole
cross-app navigation. It also owns the **acknowledgement gate**: every app bounces an
unacknowledged visitor back to entry *before* checking authentication.

## Repository layout

A polyglot monorepo — pnpm workspaces for TypeScript, a uv workspace for Python.

```text
apps/          entry · studio · operations        (Next.js 16, React 19)
packages/
  fascia       shared shadcn/base-ui components, design tokens   @artloupe/fascia
  auth         iron-session + swappable AuthProvider seam        @artloupe/auth
  schemas      shared Zod contracts (empty scaffold)             @artloupe/schemas
python/        uv workspace — agent + ML layer (empty scaffold)
supabase/      local Postgres + pgvector via the Supabase CLI
scripts/       report generators, seed scripts
docs/          ADRs, traceability, contrast, session metrics
```

## Prerequisites

| Tool | Version | Needed for | Notes |
| --- | --- | --- | --- |
| **Node.js** | 24 | everything TypeScript | Pinned in [`.nvmrc`](./.nvmrc), which CI reads via `node-version-file` — one source of truth. `nvm use` picks it up. Next.js 16 requires >=20.9. |
| **pnpm** | 10.0.0 | the TS workspace | Pinned in `packageManager` — `corepack enable` picks up the right one, so don't install it globally. |
| **Docker** | any current | `pnpm supabase start` | Runs local Postgres 17 + pgvector and Supabase Auth. **Optional** — see the demo-provider escape hatch below. |
| **uv** | current | the Python workspace | [astral.sh/uv](https://docs.astral.sh/uv/). Always invoke Python tools through it (`uv run pytest`), never bare, so they use the workspace interpreter. |
| **Python** | 3.12 | the Python workspace | Pinned in `python/.python-version`. **uv installs it for you** — a separate system Python is not required. |

### Optional command-line tools

Not needed to run, build or test the apps — each backs a single convenience script, and
none is an npm dependency, so `pnpm install` will not supply them. `curl` and `git` are
assumed present.

| Tool | Install | Needed by |
| --- | --- | --- |
| **tree** | `brew install tree` | `pnpm tree` — the repo layout listing |
| **graphviz** | `brew install graphviz` | `pnpm depcruise:graph` — renders the dependency graph through `dot` |
| **GitHub CLI** | `brew install gh` | `pnpm backlog:report`, plus the `ship` and `backlog` skills |

### Bootstrapping

The Supabase CLI, Playwright, Biome, Vale and the report generators are all
devDependencies; `pnpm install` is the only step that fetches them. Three things it does
not fetch, because they live outside the npm cache:

```sh
pnpm --filter @artloupe/studio exec playwright install --with-deps   # e2e browsers
pnpm exec vale sync                                                  # prose style packages
npx skills add vercel-labs/agent-skills --agent claude-code -y \
  --skill deploy-to-vercel vercel-composition-patterns vercel-optimize \
          vercel-react-best-practices vercel-react-view-transitions \
          web-design-guidelines writing-guidelines
```

### Agent skills

The repo uses seven third-party skills from
[`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills) (MIT) as
**development-time** guidance for the coding agent — React/Next performance review, Vercel
deployment and cost work, design and prose guidelines. They are not runtime dependencies
and ship in no build artifact.

They are **pinned but not vendored**: [`skills-lock.json`](./skills-lock.json) records each
skill's source, path and content hash, while the installed directories under
`.claude/skills/` are gitignored — committing them would mean redistributing them, which
pulls each skill's license into play. The first-party skills authored here (`wrap`, `ship`,
`backlog`, `tag-tests`) *are* tracked.

Run the command above after cloning. Reinstall details, the two CLI behaviours that make an
uninstalled skill look like a broken one, and the standing license caution before adding a
new skill are in [`.agents/skills/README.md`](./.agents/skills/README.md).

## Setup

```sh
pnpm install
cp apps/entry/.env.example apps/entry/.env.local
cp apps/studio/.env.example apps/studio/.env.local
cp apps/operations/.env.example apps/operations/.env.local
```

Set `AUTH_SESSION_PASSWORD` to a random string of 32+ characters in each app that has one
— the value in `.env.example` is a placeholder, and it encrypts the session cookie. Fill in
`SUPABASE_URL` and `SUPABASE_ANON_KEY` from `pnpm supabase status`. Then:

```sh
pnpm supabase start                      # both studio and operations sign in through it
./scripts/seed/seed-demo-accounts.sh     # pre-confirmed demo artist + operator
pnpm dev                                 # all three apps in parallel
```

Open <http://localhost:3003>, acknowledge the notice, and launch either surface.

### Demo credentials

Created by the seed script, pre-confirmed, no email is ever sent. The operator role lives
in `app_metadata`, which only the service-role key can write — which is what makes it
trustworthy as an authorization claim.

| Surface | Email | Password |
| --- | --- | --- |
| studio (`:3001`) | `demo.artist@demo.artloupestudio.com` | `demo-artist-pass` |
| operations (`:3000`) | `demo.operator@demo.artloupestudio.com` | `demo-operator-pass` |

Override with `DEMO_ACCOUNT_PASSWORD` and `DEMO_OPERATOR_PASSWORD`; both are **required**
to be non-default when seeding anything that is not local loopback.

**Re-running the script does not repair an existing account.** It skips a registered email
rather than resetting it, so an account seeded under an older default keeps that password
forever. Delete the user in Supabase Studio and re-seed to change a password or a role.

**Both apps sign in through Supabase.** `AUTH_PROVIDER` defaults to `supabase` on each, and
operations *refuses* the demo provider outside `NODE_ENV=test` — so `DEMO_AUTH_USERNAME` /
`DEMO_AUTH_PASSWORD` do not get you into the console. They exist for the hermetic e2e run.

To run the studio **without Docker**, set `AUTH_PROVIDER=demo` in
`apps/studio/.env.local` and sign in with the demo credentials instead. Everything except
Supabase Auth works unchanged.

The Python workspace bootstraps separately, and only if you're working in it:

```sh
uv sync --all-packages --directory python   # install the workspace
uv run --directory python poe check         # ruff format --check + ruff check + pytest
```

Its own tasks and conventions live in [`python/README.md`](./python/README.md).

## Quality

```sh
pnpm check:all      # everything below, in order
```

| Command | Checks |
| --- | --- |
| `pnpm format:check` | Biome formatting + lint |
| `pnpm lint` | ESLint — jsx-a11y and Next.js rules |
| `pnpm lint:css` | Stylelint |
| `pnpm lint:md` | markdownlint |
| `pnpm i18n:check` | next-intl en/es message parity |
| `pnpm traceability:check` | every test declares a flow and category |
| `pnpm contrast:check` | measured WCAG 2.2 ratio for every token pairing the apps render |
| `pnpm typecheck` | TypeScript across all workspaces |
| `pnpm test` | Vitest |
| `pnpm depcruise` | dependency-cruiser boundary rules |
| `pnpm e2e` | Playwright |

### Prose

```sh
pnpm exec vale sync   # once per clone — downloads the style packages
pnpm lint:prose       # docs, READMEs, and source comments
```

[Vale](https://vale.sh) lints this repo's own writing: markdown plus the comments and
docstrings in `.ts`, `.tsx` and `.py`. It is **advisory and deliberately outside
`check:all`** — gating commits on prose findings is a call worth making on purpose rather
than by default.

> **In progress.** The prose cleanup is not finished, and the package set in
> [`.vale.ini`](./.vale.ini) — currently Google, Microsoft, write-good, proselint,
> Readability, Harper and neighbor — is still being evaluated. Expect a large advisory
> backlog and expect the rule set to change. Generated report files are excluded, since a
> finding there has nobody to fix it.

`.vale/styles/` is gitignored — the style packages are reinstallable dev tooling, pulled by
`vale sync`. The curated word list at
[`.vale/styles/config/vocabularies/ArtLoupe/accept.txt`](./.vale/styles/config/vocabularies/ArtLoupe/accept.txt)
**is** tracked; it is this project's own vocabulary.

## Generated reports

Four generators under [`scripts/reports/`](./scripts/reports/) write the docs that would
rot if kept by hand. **None of their outputs are hand-edited** — fix the input and re-run.

| Report | Regenerate | Verify | Output |
| --- | --- | --- | --- |
| **Token contrast** — measured WCAG 2.2 ratios per token pairing, light and dark | `pnpm contrast:report` | `pnpm contrast:check` | [`docs/contrast-report/`](./docs/contrast-report/) |
| **Test traceability** — which flow each test covers, and in what respect | `pnpm traceability:report` | `pnpm traceability:check` | [`docs/test-traceability-reports/`](./docs/test-traceability-reports/) |
| **Session metrics** — cost, effort split and retro, one record per session | `pnpm session-metrics:report` | — | [`docs/session-metrics-reports/`](./docs/session-metrics-reports/) |
| **Backlog** — a generated map of the GitHub issues on the project board | `pnpm backlog:report` | — | `docs/backlog/issues.md` (not live yet — needs the board) |

The two with a `:check` form run in CI. `contrast:check` fails on any asserted pairing
below its bar and `contrast:check:strict` fails on warnings too; `traceability:check`
fails on an unknown flow or category, which is rejected rather than dropped — a row that
silently vanishes reads as coverage the project does not have.

The contrast report additionally records a **provenance fingerprint** — a SHA-256 over the
exact bytes of every input that can change a ratio — so `contrast:check` detects a stale
doc by comparing fingerprints, rather than by diffing a file whose header carries a
generation date and therefore always differs.

## Test traceability

Every test declares which application **flow** it verifies and in what **respect**
(`a11y`, `security`, `privacy`, `safety`, `data`, `performance`, `functionality`).
The catalog is [`docs/test-traceability-reports/flows.json`](./docs/test-traceability-reports/flows.json);
an unknown flow or category is a hard error in CI, not a silently dropped row.

```ts
// @trace flow=critique.formal-analysis category=functionality
```

## Documentation

- **Architecture decisions** — [`docs/decision-records/`](./docs/decision-records/)
- **Current state** — [`docs/current-state.md`](./docs/current-state.md), read first each session
- **Token contrast** — [`docs/contrast-report/`](./docs/contrast-report/), the baseline the next palette change is measured against
- **Agent skills** — [`.agents/skills/README.md`](./.agents/skills/README.md), what's pinned in `skills-lock.json` and why none of it is vendored

## License

Apache 2.0 — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
