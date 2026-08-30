# Session metrics

Machine-readable record of how this project got built — cost, effort distribution, and
collaboration retrospective. **One pretty-printed JSON file per CLI session** in
`sessions/`, plus a generated report.

**Purpose:** track whether AI-collaboration effectiveness is improving over time.
Raw cost and duration are *not* the signal — they're dominated by task difficulty.
The signal is in the ratios: churn %, churn attribution, docs overhead, cost per merged PR.

## Layout

| Path | Notes |
| --- | --- |
| `sessions/YYYY-MM-DD-slug.json` | one record per CLI session — hand-editable |
| `report.md` | **generated** — summary, charts, retros |
| `sessions.md` | **generated** — the full per-session table |
| `charts/*.svg` | **generated** — one file per chart, both themes baked in |
| `../../scripts/reports/session-metrics-report.mjs` | the generator (`pnpm session-metrics:report`) |
| `../../.claude/skills/wrap/` | `/wrap` — drafts a record, writes it, regenerates everything |

Everything except `sessions/*.json` is generated. **Never hand-edit the report, the table,
or the charts** — fix the session record and re-run `pnpm session-metrics:report`.

**Filenames sort chronologically.** When more than one session lands on a date, add an
`-a-` / `-b-` infix (`2026-07-09-a-specialist-extraction.json`) so alphabetical order
matches the order they happened — the generator sorts by filename.

**Written by `/wrap`.** Claude drafts every field; Laurie corrects. Never a blank form.

## Schema

| Field | Notes |
| --- | --- |
| `date` | ISO date of the session |
| `label` | short human description |
| `cli_sessions` | Claude Code session UUID(s) contributing to this row |
| `parallel_agents` | max concurrent agents/worktrees; `1` = single-threaded |
| `confidence` | `measured` (captured live) or `reconstructed` (backfilled — approximate) |
| `themes` | one or more of `agent` · `app` · `evals` · `data` · `ops` · `devex` |
| `cost_usd` | from `ccusage`; API-equivalent, informational on the Max plan. `null` if not captured |
| `api_minutes` / `wall_minutes` | duration |
| `context_over_150k_pct` | share of usage above 150k context — the cache-read cost driver |
| `effort_split` | % across `build` / `setup` / `design` / `docs` / `verify_ops` / `churn`, sums to 100. The generator **rejects** unknown keys — an unchartable bucket would silently vanish from the stacked bars |
| `churn_attribution` | % of the *within-session* churn by cause: `under_specified` (prompt), `claude_error`, `genuine_discovery` |
| `rework_of` | record ids (filename without `.json`) of earlier sessions whose work this one redid — **cross-session** rework, the expensive kind |
| `delivered` | `prs` / `issues` / `adrs` numbers. `prs_merged` and `issues_closed` are deliberately not tracked — PRs merge shortly after opening here, so both would just shadow `prs` |
| `review` | CodeRabbit findings by disposition; `ci_reruns` counts infra retries |
| `ratings` | 1–5: `scoping_clarity`, `decision_stability`, `tooling_leverage` |
| `decisions` | short pointers to what got decided; ADRs remain the canonical record |
| `retro` | prose: `went_well`, `improve`, `tooling_suggestion` |
| `note` | optional caveat (shared CLI session, remapped bucket, etc.) |

### Theme vocabulary

| Theme | Covers |
| --- | --- |
| `agent` | the Python backend — LangGraph graphs, MCP servers, FastAPI endpoints |
| `app` | the three Next.js frontends in `apps/*` and `packages/fascia` |
| `evals` | eval harness, DoD gates, metrics |
| `data` | corpus, ingestion, pgvector, persistence, migrations |
| `ops` | deploy, infra, local stack, live verification |
| `devex` | tooling, CI, rules, skills, docs infrastructure |

### Reading the numbers

- **`churn_attribution` is the point.** "We lost time" is noise; *why* is the skill.
  A falling `under_specified` share over time is the improvement curve.
- **`docs` is tracked apart from `design` on purpose.** Design deliberation is the work;
  doc maintenance is overhead. Bundled, a steady 15% upkeep cost stays invisible — split,
  it's an automation target.
- **`declined` is ambiguous.** Rising declines could be sharpening judgment or creeping
  dismissiveness — the PR threads carry the reasoning; read them before concluding.
- **Charts window to the last 20 days**; `sessions.md` keeps the full history. Beyond
  that the day columns get too narrow to read.
- **Two kinds of rework.** `churn` is within-session; `rework_of` is a later session
  redoing earlier work. The second is more expensive — it means a decision didn't hold —
  and it's the one `churn` alone can't see.
- **`confidence` marks how a row was captured.** `measured` means the numbers came from
  `/usage` during the session; `reconstructed` means they were backfilled afterwards, with
  qualitative fields inferred from prose rather than captured live. The report calls out
  reconstructed rows only when there are any — don't read them as measurement.

## Charts

SVG rather than mermaid: `xychart-beta` supports neither stacked bars nor dot plots.

Each chart is **one file carrying both themes** in an internal `<style>` block — light on
`:root`, dark under `@media (prefers-color-scheme: dark)` — referenced with plain
`![](charts/name.svg)` markdown. The earlier approach emitted a light/dark pair behind a
`<picture>` element and failed twice: VS Code's markdown preview doesn't support
`<picture>` (broken image), and the transparent background left dark title ink sitting on
whatever surface the viewer happened to use. The opaque surface rect fixes the second;
one self-adapting file fixes the first. A renderer that ignores the media query falls back
to light, which is still readable.

Palette is the dataviz reference categorical slots, validated in both modes — worst
adjacent CVD ΔE 9.1 light / 8.4 dark on the five effort buckets. Three light-mode slots
fall below 3:1 contrast, so the relief rule applies: `sessions.md` is the table view,
linked from the report.

Two deliberate constraints worth not undoing:

- **No dual y-axis** on the cost/time chart. Two independent scales on one plot let the
  author manufacture any apparent correlation by choosing where each axis starts. Cost and
  wall time are two panels sharing one x-axis instead — same comparison, no distortion.
- **The theme dot plot's six colors do not clear the all-pairs CVD gate** (orange↔green
  ΔE 3.2 protan). That's acceptable *only* because the y-axis label and row position carry
  identity and the color is redundant reinforcement. If this ever becomes a scatter where
  color is the only way to separate themes, the six-color scheme has to go.

Effort stays **per session**; cost and themes collapse **per day**. Effort is a composition
whose churn attribution is a per-session judgment — averaging it across a day would blur
the one field the whole exercise exists to capture.

## Open items

- Under parallel worktrees each session wraps itself, so effort and churn attribution are
  scoped to what that Claude actually saw. Don't sum across project dirs — that double-counts.
- Issue content-drift ("story drift") counts — title changes via the issue timeline API,
  body edits via GraphQL `userContentEdits`.

### Retired

- **`forks_gated_up_front`** (dropped 2026-07-18). Counted decisions settled before
  building, to test whether front-loading them reduces rework. It doesn't measure that:
  sessions needing many decisions are *hard* sessions, so the count tracks difficulty,
  which independently drives churn. r came out at -0.09 across 34 sessions. Testing the
  hypothesis properly needs difficulty held constant, which this dataset can't do.
- **The "duplicate project dirs" concern.** Not a live problem: the extra
  `~/.claude/projects/*art-loupe*` dirs are historical (a repo move plus finished
  worktrees), and per-session `/wrap` reads only its own session, so nothing double-writes.
