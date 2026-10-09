# Art Loupe

**A reference photograph in, a medium-aware working plan out — every claim measured,
cited, or chosen, and never an image generated.**

Art Loupe is a multi-agent studio assistant for working artists. The artist uploads a
reference photograph and says what they want to make; a Studio Director agent routes it
through deterministic image analysis and grounded retrieval, and returns a time-boxed
working plan in the artist's medium. Every claim in the plan is **measured** (a pixel
fact), **cited** (an open-access instructional source), or **chosen** (an explicitly
labelled artistic call).

> **The system never generates or alters imagery.** It reasons about a photograph the
> artist supplies, and the artist makes the work. That is a design commitment, not a
> limitation: it keeps the tool on the right side of authorship and copyright, and it
> keeps "never generates" structurally verifiable rather than a policy promise.

⚠️ **Educational demonstration only.** Art Loupe is a portfolio/capstone demo. It is not
a valuation, authentication, or legal service. See [`NOTICE`](./NOTICE).

> Domain: `artloupestudio.com` · package scope: `@artloupe/*`. This README documents a
> **work in progress** — [`docs/current-state.md`](./docs/current-state.md) says what
> works today.

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
| **Reference intake** | One reference photograph plus a stated intent — medium, time budget, goal. Untrusted text in the filename, EXIF and goal is screened at ingest; the original is immutable. |
| **Image analysis** | Deterministic studies — grayscale, three- and five-value maps, an eight-colour palette with click-sampling, structural outlines, a transfer grid, and crop candidates at the artist's support aspect ratio — and geometry: head construction from face landmarks, perspective from vanishing points. Each geometry result carries a measured confidence; a low one pauses the run for the artist to confirm or correct. No inpainting, no generation. |
| **Working plan** | A medium-aware plan of time-boxed stages with a brand-neutral materials list and a self-check card, exported as a study-pack PDF. Instructional claims are cited through hybrid retrieval over open-access sources, and the **Plan Critic** checks the plan before the artist sees it. |
| **Studio chat** | Grounded questions about the reference and the medium. An answer that implies plan work proposes an amendment the artist accepts. Metered in daily credits, on a ledger separate from the plan budget. |
| **Operations** | Traces, cost and latency per agent, grounding, safety assertions, and evaluation health. |

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
  schemas      shared Zod contracts, mirrored in Python          @artloupe/schemas
python/        uv workspace — libs/* and the LangGraph service in services/agent
supabase/      local Postgres + pgvector via the Supabase CLI
scripts/       report generators, seed scripts
docs/          ADRs, traceability, contrast, session metrics
```

## Prerequisites

| Tool | Version | Needed for | Notes |
| --- | --- | --- | --- |
| **Node.js** | 24 | everything TypeScript | Pinned in [`.nvmrc`](./.nvmrc), which CI reads via `node-version-file` — one source of truth. `nvm use` picks it up. Next.js 16 requires >=20.9. |
| **pnpm** | 10.0.0 | the TS workspace | Pinned in `packageManager` — `corepack enable` picks up the right one, so don't install it globally. |
| **Docker** | any current, Compose v2+ | `pnpm supabase start`, and [Running in Docker](#running-in-docker) | Runs local Postgres 17 + pgvector and Supabase Auth. **Optional** — see the demo-provider escape hatch below. |
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

The Supabase CLI, Playwright, Oxlint, Oxfmt, Vale and the report generators are all
devDependencies; `pnpm install` is the only step that fetches them. Two things it does
not fetch, because they live outside the npm cache:

```sh
pnpm --filter @artloupe/studio exec playwright install --with-deps   # e2e browsers
pnpm exec vale sync                                                  # prose style packages
```

### Agent skills

The first-party skills authored here (`wrap`, `ship`, `backlog`, `tag-tests`) are tracked
in `.claude/skills/`. No third-party skill is vendored or pinned in the repo — any the coding
agent uses are installed globally, outside it.

## Setup

```sh
pnpm install
cp apps/entry/.env.example apps/entry/.env.local
cp apps/studio/.env.example apps/studio/.env.local
cp apps/operations/.env.example apps/operations/.env.local
```

Set `AUTH_SESSION_PASSWORD` to a random string of 32+ characters in each app that has one
— the value in `.env.example` is a placeholder, and it encrypts the session cookie. Fill in
`SUPABASE_URL` and `SUPABASE_ANON_KEY` from `pnpm supabase status`. The password is a secret, but
a local one protects nothing, so `.env.local` is fine here. With `APP_ENV=production` the apps
ignore it and read only a mounted file, `AUTH_SESSION_PASSWORD_FILE` or
`/run/secrets/auth_session_password`. Then:

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

### The Python agent

The apps run without the agent. The studio falls back to committed fixtures, and the
operations panels say their data is unavailable. Real runs, run health, cost and the
learning assistant all need the agent. These steps start it.

#### 1. Install the workspace

```sh
uv sync --all-packages --directory python
uv run --directory python poe check         # ruff format --check + ruff check + pytest
```

#### 2. Write `python/.env`

```sh
cp python/.env.example python/.env
```

Uncomment and set these lines:

```sh
APP_ENV=local
ARTLOUPE_KEYCHAIN_SERVICE=<keychain service>
ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT=<account of the Anthropic item>
ARTLOUPE_OPENAI_KEYCHAIN_ACCOUNT=<account of the OpenAI item>
ARTLOUPE_PEXELS_KEYCHAIN_ACCOUNT=<account of the Pexels item>  # optional: Get Inspired
ARTLOUPE_RUN_LOG=postgres        # the studio streams runs from public.runs
ARTLOUPE_METERING=postgres       # the cost panel reads public.run_node_metrics
```

The file holds keychain coordinates, never a key. A key written into it is ignored, and so is a
key exported in the shell: a secret is never read from the process environment.

Not every setting is read from this file. Each one has its own loader:

| Setting | Where it must be set |
| --- | --- |
| Keychain coordinates and `APP_ENV` | `python/.env` or `python/.env.local`, read from a fixed path |
| `ARTLOUPE_RUN_LOG`, `ARTLOUPE_METERING`, `DATABASE_URL`, auth settings | `python/.env` only, and only when the agent starts in `python/`, as `uv run --directory python` does |
| `ARTLOUPE_OPS_DATABASE_URL`, `ARTLOUPE_LEARNING_CORPUS`, `ARTLOUPE_RETRIEVAL_BACKEND`, `ARTLOUPE_LEARNING_DATABASE_URL`, `ARTLOUPE_LEARNING_INGEST_DATABASE_URL` | The shell environment only. Neither env file is read for these. |

#### 3. Put the provider keys in the keychain

Every secret resolves the same way, and the first match wins:

1. The macOS keychain, when `APP_ENV` is `local` and that secret's keychain account is set.
2. A mounted file, at `<NAME>_FILE` when that is set and `/run/secrets/<name>` otherwise.
   Docker, CI and production use this.
3. Outside production only, a throwaway value. Only the local database URLs have one.

Paid provider keys are refused outright in CI (`CI=true` or `APP_ENV=ci`), whatever is
mounted, so CI can never spend tokens.

Locally, the Anthropic, OpenAI and Pexels keys come from the macOS login keychain. The items
share one service and differ by account. Store each one once:

```sh
security add-generic-password -s <service> -a <account> -w     # prompts for the key
security add-generic-password -U -s <service> -a <account> -w  # -U replaces an existing item
```

Ending the command at `-w` makes `security` prompt for the key, so the key never lands in
shell history.

To check that an item exists without printing the key:

```sh
security find-generic-password -s <service> -a <account>
```

It prints the item's attributes, or "The specified item could not be found" and exit code 44.
Adding `-w` prints the key itself, so use it only when you need the value.

To list every account stored under a service, without printing any key:

```sh
security dump-keychain | grep -B15 '"svce"<blob>="<service>"' | grep '"acct"'
```

Anthropic is required for runs and learning answers. OpenAI is needed only for learning
embeddings. Without OpenAI, the learning assistant falls back to keyword search. Without Pexels,
Get Inspired reports its Pexels source as unavailable.

To confirm both keys authenticate, without generating anything:

```sh
uv run --directory python --all-packages python -m artloupe.agent.learning.cli verify
```

#### 4. Build the learning corpus (once)

For PostgreSQL publication, Docker setup, and Cloud Run configuration, see
[`PostgreSQL ingestion and retrieval`](./docs/learning/pgvector.md).

The learning assistant answers from three books, which live outside the repo in
`../../reference-docs/books`. The generated corpus is gitignored, so every checkout builds
its own. Run these commands from `python/`:

```sh
uv run --all-packages python -m artloupe.agent.learning.cli ingest \
  --books /absolute/path/to/reference-docs/books \
  --manifest ../docs/learning/books.json --output learning-corpus

# Optional, and it spends money: OpenAI embeddings for semantic and Spanish retrieval.
uv run --all-packages python -m artloupe.agent.learning.cli embed \
  --corpus learning-corpus --allow-paid
```

Skip this step if you don't need the learning assistant. The agent starts without a corpus.
[`docs/learning/README.md`](./docs/learning/README.md) covers the design and the evals.

#### 5. Start the agent

Supabase must be running, as described under Setup. From the repository root:

```sh
ARTLOUPE_OPS_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
ARTLOUPE_LEARNING_CORPUS="$PWD/python/learning-corpus" \
uv run --directory python python -m artloupe.agent.service      # 127.0.0.1:8080
```

Without `ARTLOUPE_OPS_DATABASE_URL`, the operations endpoints answer 503. With the file backend, omitting
`ARTLOUPE_LEARNING_CORPUS` leaves the learning endpoint unavailable (503). With pgvector,
configure its database connection and publish a corpus; no corpus filesystem setting is needed.

#### 6. Point the apps at it

Set `ARTLOUPE_AGENT_URL="http://127.0.0.1:8080"` in `apps/studio/.env.local` and
`apps/operations/.env.local`, then run `pnpm dev`.

| Feature | Where |
| --- | --- |
| Start a run and watch it stream | studio, a project page, "Analyse this reference" |
| Learning assistant | studio, `/en/learn` or `/es/learn` |
| Cost and run health, with a per-run drill-down | operations home page |

These actions spend money: a studio run (the Director calls Anthropic), each learning answer,
the `embed` step, `learning.cli eval --live`, and `poe test-live`.

The Python workspace's own tasks and conventions live in
[`python/README.md`](./python/README.md).

### Running in Docker

Docker Compose can run the agent and all three apps in one step. Supabase stays on its own
CLI, outside Compose. Running without Docker, as described above, keeps working unchanged.

You need Docker Desktop, a host `pnpm install` (for the Supabase CLI), and `python/.env`
written as in step 2. Then, from the repository root:

```sh
./scripts/docker/up.sh          # extra arguments go to `docker compose up`, e.g. --build
docker compose logs -f          # follow the logs
docker compose restart agent    # after a Python change
docker compose down             # stop; Supabase keeps running
```

The script starts Supabase if it isn't running and seeds the demo accounts. It then starts
the containers in the background. The apps are at the usual addresses, and the agent is at
`127.0.0.1:8080`. The first start installs dependencies into Docker volumes and takes a few
minutes.

- **Provider keys come from the keychain.** The script reads each key at the coordinates
  `python/.env` names, as the host agent does. Compose gives each key to the agent as a file
  under `/run/secrets`. A key whose keychain account isn't configured is skipped, and that
  feature reports itself unavailable.
- **Keys are never written to a file on the host.** Compose copies each one into the agent
  container's filesystem, where it stays until `docker compose down` removes the container.
- **Each start signs you out.** The apps' session passwords are generated fresh every time.
- **The agent runs under emulation on Apple silicon.** `mediapipe` publishes no Linux arm64
  wheel, so the agent image is `linux/amd64`, and analysis is slower than on the host.
- **The containers run with `APP_ENV=docker`.** That behaves like `local`, except it never
  reads the keychain or `python/.env`.
- **Containers reach Supabase at `host.docker.internal`.** Tokens still name `127.0.0.1` as
  their issuer, so the agent is given that issuer explicitly through `SUPABASE_ISSUER`.
- **The learning assistant answers 503.** The selected retrieval backend has no corpus.
  Docker uses pgvector: migrate and publish the prepared corpus as described in
  [`docs/learning/pgvector.md`](./docs/learning/pgvector.md).

## Quality

```sh
pnpm check:all      # everything below, in order
```

| Command | Checks |
| --- | --- |
| `pnpm format:check` | Oxfmt formatting + import sorting |
| `pnpm lint` | Oxlint — jsx-a11y, React, Next.js, TypeScript, and house rules |
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
| **Backlog** — a generated map of the GitHub issues on the project board | `pnpm backlog:report` | — | [`docs/backlog/issues.md`](./docs/backlog/issues.md) |

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
// @trace flow=analysis.geometry category=functionality
```

## Documentation

- **Architecture decisions** — [`docs/decision-records/`](./docs/decision-records/)
- **Current state** — [`docs/current-state.md`](./docs/current-state.md), read first each session
- **Design** — [`docs/design/`](./docs/design/), starting with [`requirements.md`](./docs/design/requirements.md)
- **Token contrast** — [`docs/contrast-report/`](./docs/contrast-report/), the baseline the next palette change is measured against

## License

Apache 2.0 — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
