---
name: wrap
description: End-of-session wrap-up — write a metrics record to docs/session-metrics-reports/sessions/, regenerate the metrics report, and overwrite docs/current-state.md. Use when the user says to wrap up, close out the session, or log the session. Accepts "record only" to write just the session record when several sessions are wrapping the same day.
---

# Session wrap-up

Three outputs: a **metrics record** (`docs/session-metrics-reports/sessions/`), the
**regenerated report** (`pnpm session-metrics:report`), and the **current-state doc** (`docs/current-state.md`, per
`.claude/rules/current-state.md`).

## Record-only mode

**Invoked as `/wrap record only` (or `record-only`).** Do §1 and §2 as written, write the
JSON in §3 step 1, then **stop**. Skip `pnpm session-metrics:report`, skip `docs/current-state.md`,
skip the charts. Say plainly that the batch steps are still outstanding.

Use it when **more than one session is wrapping the same day** — the common case on a
parallel-worktree day. Only the session records are per-session; everything else the full
mode produces is *derived from all of them*:

- `report.md`, `sessions.md` and `charts/*.svg` are regenerated wholesale every run, so N
  sessions each running the full mode rewrite the same four files N times. Each rewrite is a
  fresh merge-conflict surface, and a generated file has already landed in `UU` this way.
  They are also **generated** — never hand-resolve a conflict in them, just re-run the
  generator.
- `current-state.md` is a snapshot that carries no history. N successive overwrites leave
  N-1 versions in the log that were superseded before anyone read them, and a session that
  overwrites from its own view silently drops what the others wrote.

**Closing the batch** — once, after the last record lands:

```sh
pnpm session-metrics:report      # picks up every new record at once
pnpm format && pnpm lint:md
```

Then reconcile `docs/current-state.md` **once**, against all the day's records together.
Read the existing file and amend it — do not overwrite it from one session's perspective.
Commit the whole batch as one `docs(metrics): <date> session records and current-state refresh`.

Everything below is the full mode.

**Core rule: draft every field yourself, then show it for correction.** Never present a
blank form and never ask Laurie to self-report numbers you can compute. She corrects; she
does not fill in. This is the whole reason the ritual is sustainable.

## 1. Gather what's measurable

Run these before drafting anything.

**One row per CLI session.** A session running in a worktree wraps *its own* work — do not
try to account for what a parallel session did, and do **not** sum across every
`~/.claude/projects/*art-loupe*` dir, which would double-count once each session wraps
itself. Read only this session's own usage:

**`cost_usd`, `api_minutes`, `wall_minutes` and `context_over_150k_pct` all come from
`/usage`** — a slash command only Laurie can run, so ask for its output rather than guessing.
It reports total cost, API duration, wall duration, per-model tokens, the limit windows, and
the last-24h context and skills breakdown. **There is no `/cost` command** — it was replaced
by `/usage`. **`ccusage` is not a substitute** either: on the Max plan it undercounted the
same session by 36% ($68.82 against `/usage`'s $108.52). Its *token* counts are real; its
cost is not.

Two things in `/usage` are **not session-scoped** — the context percentage and the skills
breakdown are last-24h across every local session. Say so in `note` rather than attributing
another session's skill usage to this one.

```sh
# Token counts only — cost from /usage, never from here.
ccusage session --json -i <this-session-uuid>

# Delivered — PRs and issues opened for this work
gh pr list --state all --search "created:>=<DATE>" --json number,title
gh issue list --state all --search "created:>=<DATE>" --json number,title
```

`prs_merged` and `issues_closed` are deliberately **not** tracked: PRs here merge shortly
after opening, and issues close after their PR merges, so both would just shadow `prs`.

For `review.*`, count findings by disposition on any PR touched this session: `fixed`
(defect corrected in-PR), `deferred` (valid but out of scope → became an issue), `declined`
(not applicable / wrong direction / gold-plating). The *reasoning* lives in the PR body or
thread reply — don't duplicate it here, just count.

The reviewer is **Greptile** (`greptile.json`), usually run from the terminal once the branch
is final, so the findings often exist only in that run's output and the PR body rather than as
GitHub threads — count from wherever they actually landed. The field name stays
`coderabbit_findings` for continuity with records written before the switch; read it as
"review findings" regardless of which tool produced them.

If a number genuinely isn't available (e.g. the current session hasn't flushed to disk
yet, or Laurie hasn't pasted `/usage`), write `null`. **Never estimate a measured field.**

## 2. Draft the judgment fields yourself

These are the ones only you can write, because you were in the conversation:

- **`effort_split`** — % across `build` / `setup` / `design` / `docs` / `verify_ops` /
  `churn`, summing to 100. Only these keys chart; the generator rejects anything else. Churn = rework and detours, the number to drive down. Keep `design`
  (deliberation, ADRs, decisions) separate from `docs` (maintaining plan/log/README) —
  the split exists so doc *overhead* stays visible as an automation target.
- **`rework_of`** — **record ids** (the session filename without `.json`) of *earlier*
  sessions whose work this one redid. Use ids, not dates — several sessions can share a
  date, and `2026-07-13 redid work from 2026-07-13` names nothing. Cross-session
  rework is the expensive kind: it means a decision didn't hold, so everything built on it
  gets revisited. Check the `decisions` arrays of recent records before writing this —
  if this session superseded one of them, say so.
- **`churn_attribution`** — split the *within-session* churn by cause: `under_specified` (the prompt didn't
  carry what it needed), `claude_error` (I misread, assumed, or ignored something in
  context), `genuine_discovery` (nobody could have known upfront). **Be honest about
  `claude_error`** — a metric that flatters me is worthless to her.
- **`ratings`** — 1–5 on `scoping_clarity` (how clear was the ask at session start?),
  `decision_stability` (did settled decisions stay settled — including *your own* design
  calls?), `tooling_leverage` (skills, subagents, running the right command first time).
  **Make these vary.** A column of 5s is worse than no column: it looks like data and
  carries nothing. If a session was mediocre on a dimension, say 3.
- **`decisions`** — short pointers to what got decided, one line each. Reference the ADR
  where one exists; don't restate it. This is what makes `decision_stability` auditable.
- **`themes`** — one or more of `agent` · `app` · `evals` · `data` · `ops` · `devex`.
- **`retro`** — `went_well`, `improve`, `tooling_suggestion`; a sentence or two each.
  Feedback Laurie gave belongs here too, folded in without who-said-it labels: her
  corrections usually land in `improve`, useful patterns in `went_well`.

Also set: `confidence` (`measured` live, `reconstructed` for backfill), `parallel_agents`
(max concurrent worktrees/agents). `context_over_150k_pct` comes from `/usage` (see §1).

## 3. Confirm, then write

Show the drafted record and ask for corrections **before** writing. Then:

1. Write `docs/session-metrics-reports/sessions/YYYY-MM-DD-slug.json`, pretty-printed with 2-space indent.
   If another session already exists for that date, add an `-a-` / `-b-` infix to **both**
   so the filenames sort in the order the sessions actually happened — the report generator
   sorts by filename.
2. Run `pnpm session-metrics:report` to regenerate `report.md`, `sessions.md`, and `charts/*.svg`.
   Never hand-edit any of them; if a number looks wrong, fix the session record and re-run.
3. **Overwrite** `docs/current-state.md` — both §1 (human snapshot) and §2 (agent pickup
   notes) — per `.claude/rules/current-state.md`. Replace, don't append: it holds no
   history. Keep it short; if it grows every session, something in it belongs in the
   metrics record, an ADR, or `settled-decisions.md`.
4. Run `pnpm format` then `pnpm lint:md`. Biome formats JSON, so a hand-written record
   will fail `format:check` (and block the commit via husky) until it's normalized.

Do not commit unless asked.
