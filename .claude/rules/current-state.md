# Maintaining `docs/current-state.md` and `docs/session-metrics-reports/`

Session record-keeping is split across two homes, by mutability. Putting a fact in the
wrong one is the mistake this rule exists to prevent — a single combined session log
mixed living state with immutable history, and the current-state pointer went stale
underneath 2,900 lines of it. That practice is retired: do not recreate a session log.

| Home | Mutability | Holds |
| --- | --- | --- |
| `docs/current-state.md` | **living — overwrite** | where things stand *now*: §1 human snapshot, §2 agent pickup notes |
| `docs/session-metrics-reports/sessions/*.json` | **append one file** | one record per CLI session: cost, effort, rework, decisions, retro |
| `docs/session-metrics-reports/report.md` + `sessions.md` + `charts/` | **generated** | never hand-edited; `pnpm session-metrics:report` |

Settled constraints live in `docs/decision-records/settled-decisions.md`; architectural
commitments become numbered ADRs. Neither belongs in the current-state doc — link instead.

## End-of-session checklist

Run the **`/wrap` skill**, which does all of this. Manually, it is:

1. **Write the metrics record** — `docs/session-metrics-reports/sessions/YYYY-MM-DD-slug.json`.
   Claude drafts every field from `ccusage` + `gh` + the session itself; Laurie corrects. Never a
   blank form, and never ask her to self-report a number that can be computed.
   **One row per CLI session** — a session running in a worktree wraps its own work.
2. **Regenerate** — `pnpm session-metrics:report`.
3. **Overwrite `docs/current-state.md`** — both §1 and §2, as a snapshot of the present.
   This is a replace, not an append. It carries no history and is never dated as history.
4. **Run `pnpm format`, then `pnpm lint:md`.** Biome formats JSON, so a hand-written
   record fails `format:check` — and husky blocks the commit — until it's normalized.

## What goes where

- "Slice 6 is feature-complete; PR #38 is open awaiting review" → **current-state §1**
- "Next step: run `poe eval-live`, then Slice 7" → **current-state §2**
- "This session cost $26.60, was 70% build, and 10% of it was churn" → **metrics record**
- "We chose Presidio over regex" → **ADR**, referenced from the record's `decisions`
- "Rebase breaks SSH signatures, so squash-merge" → **settled-decisions.md**

## Writing the current-state doc

- §1 is plain language: what's merged, what's in flight with CI status, open questions,
  read-first pointers. Update its `**Updated:**` date.
- §2 is dense shorthand for a fresh AI session: full merged inventory, the exact pick-up
  step, locked decisions, housekeeping gotchas.
- Keep it **short**. It is a snapshot, not an accumulation — if it's growing every session,
  something in it belongs in metrics, an ADR, or settled-decisions instead.

## Formatting

- Bullets use `-` (dash). Never start a wrapped line with `+ ` or `* ` — markdownlint reads
  it as a list marker and the file's ul-style cascades (MD004).
- Surround lists and tables with blank lines; headings increment by one level only.
