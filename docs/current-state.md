# Current state

**Updated:** 2026-09-07

## 1. Snapshot

**Slice 1 is eight of fourteen PRs in — PR 7 now complete in both halves — and the app is
demoable for the first time.** An artist can sign in, open `/projects/new`, upload a reference
photograph with a stated intent, and land on a project page — every step in a real browser rather
than only in a test.

Art Loupe turns a reference photograph into a medium-aware, time-boxed working plan where every
claim is **measured** (a pixel fact), **cited** (an instructional source), or **chosen** (a
labelled artistic call). It never generates or alters imagery.

### Where the ladder stands

| PR | What | State |
| --- | --- | --- |
| 1-3 | contracts · agent service · Postgres checkpointing | merged (#13, #16, #17) |
| 4 | loop guards + per-node token/latency/cost ledger | merged (#19) |
| 5 | `projects`, immutable `source_images`, RLS, storage helpers | merged (#20) |
| 6 | route-handler gating + issue #22 complete deletion | merged (#29) |
| 7a | upload, intake, EXIF/filename/goal screening, detections table | merged (#31) |
| 7b | intake form, `/projects/[id]`, i18n copy, browser e2e | merged (#37) |
| 9 | overlay primitives in `packages/fascia` | merged (#21) |
| 8, 10-14 | plates · CV · routing · interrupt · ops | **not started** |

### What works today

- **An artist can complete an upload from the browser.** `/projects/new` carries the FR-102
  fields, posts multipart to `/api/projects`, and a 201 opens `/projects/[id]`.
- **Every refusal reason renders as something actionable**, in English and Spanish, through a
  focused error summary that links each problem to its field.
- **Untrusted text is screened at ingest** on three of five surfaces — filename, EXIF, and the
  artist's free-text goal, which the form now sends **verbatim**, whitespace included.
- **The two unscreened surfaces are written down**, not omitted, as `surface-not-screened` rows.
- **Route handlers are gated**, artist deletion reaches the bytes, and an interrupted run resumes
  in a different process against real Postgres.
- **633 tagged tests, 0 untagged**, across Vitest, Playwright and pytest.

### What is *not* demoable, and should be said plainly

**The project page is a stub and says so.** There is no GET for a project, so it confirms the
upload and never claims the project was *loaded*. There is no project list — `/home` is a heading
and a link.

**The graph still runs no agent.** `graph.py` is `START → seed → END`; there is no LLM SDK
anywhere in the workspace. PR 12 adds the one model call in the slice. After all fourteen PRs,
slice 1 exercises the `measured` arm of the evidence union and nothing that produces a `cited`
one — no critique, no retrieval, no citations, no Plan Critic. Deliberate spine-before-payload,
but "multi-agent" would overclaim what slice 1 shows.

### Open questions

- **The ack-cookie-lifetime question in [#27](https://github.com/lsr-explore/art-loupe/issues/27)
  is still unanswered.** Recommendation recorded there; the call is Laurie's.
- **`greptile config` reports `Rules (0): (none)`** while `greptile.json` declares three
  `customContext.rules`, including the WCAG 2.2 AA rule scoped to `apps/*/src/**`. Two reviews of
  an almost entirely new-UI PR raised no accessibility finding, and the output cannot distinguish
  a clean bill from a rule that never loaded. Worth confirming before relying on that rule.
- **ADR numbering.** 0003 is the deletion ADR; `settled-decisions.md`'s scope amendment needs 0004.
- **Six issues are deliberately unparented** (#32, #33, #34, #36, #38, #39). Epic #5 is scoped to
  static-analysis tooling. Two epics suggest themselves — slice-1 safety completion, and
  ingest durability, which #38 and #39 would both sit under.
- The `.task` model licence, `flows.json` restructure, guard defaults, `BudgetExceeded → 429`,
  chat credits, embedding model, materials corpus and gold set all remain as previously recorded.
- **A drag-and-drop target** is in the walkthrough's beat 3 and was not built; the labelled file
  input is the accessible baseline. Unfiled — say if it should be an issue.

### Read first

- [`CLAUDE.md`](../CLAUDE.md) · [`design/slice-1-build-plan.md`](./design/slice-1-build-plan.md)
- [`decision-records/0003-project-deletion-holds-the-artist-token.md`](./decision-records/0003-project-deletion-holds-the-artist-token.md)
- [`design/geometry-confidence-plan.md`](./design/geometry-confidence-plan.md) — binds PRs 10-12

## 2. Agent pickup notes

**State:** slice 1, PRs 1-7b and 9 of 14 merged. `main` at `45bbf5b`. No open PRs. No worktrees.
Backlog is GitHub issues on user project 3; #38-#39 filed 2026-09-07.

**Next step: PR 11 before PR 10** (approved 2026-09-05). PR 11 owns the `opencv-contrib-python`
dependency and the one-`cv2`-provider hygiene test, so a red CI means only that. Recreate its
worktree with `wt new` against current `main`. PR 8 (the plate suite) is also unblocked and has
no dependency fight — either is a legitimate next pick.

**Scope is settled.** Art Loupe = reference photo → medium-aware working plan. Never generates
imagery. Artwork critique is **cut**; the **Plan Critic** is **kept**.

**Load-bearing invariants** — unchanged, plus this session's:

- Every claim is `measured` | `cited` | `chosen`; an artist assertion is never evidence.
- Only `confirmed` / `adjusted` regions reach measurement.
- Chat credits and the plan budget are separate ledgers.
- `interrupt()` sits **alone** in its node, or resume double-charges the ledger.
- Checkpoints live in the `langgraph` schema via `options=-csearch_path=langgraph,public`.
- **An original is immutable against every verb**, at both layers.
- **Deletion is two systems and cannot be one transaction.** Objects before rows.
- **Ingest runs the opposite order: object BEFORE the row that cites it.**
- **No app runtime holds `service_role`.** Every storage and PostgREST call uses the artist's token.
- **The screener's rules are data, not code**, mirrored across two regex engines over one fixture.
- **A surface nothing screened is a row, not an absence.**
- **A detection is a record.** `screening_detections` has no UPDATE and no DELETE.
- **The artist's goal is sent untrimmed.** Every other intake field is trimmed; that one is prose
  they wrote, stored as provenance and screened as untrusted text, so the client sanitizes none of
  it. Blank still resolves to `null` — a trimmed *copy* decides that.
- **The client never checks the file's declared type.** `inspect-image.ts` sniffs the bytes;
  `accept` is a picker hint. A browser reporting a wrong `File.type` must not be refused locally.
- **Client-side validation is a round-trip courtesy, never the boundary.**
- Confidence must measure the detector, never the sitter.

**Stack:** pnpm workspaces + uv workspace (`libs/auth|schemas|persistence|metering`,
`services/agent`). Next 16 / React 19 — read `node_modules/next/dist/docs/` first. Node 24,
pnpm 10.0.0, **vitest 5**.

**`@artloupe/schemas` has zod-free subpaths, and client code must use them.**
`@artloupe/schemas/intent-values` (`MEDIA`, `SKILL_LEVELS`) and `/image-limits`
(`ACCEPTED_MIME_TYPES`, `MAX_UPLOAD_BYTES`, `MIN_LONG_EDGE_PX`). The barrel re-exports both, so
server code is unaffected — but importing a constant *through the barrel* from a client component
pulls all of Zod in: measured at 248 → 347 kB gzipped against a 300 kB budget. Type-only imports
from the barrel are fine; they are erased. **`pnpm size` is the only check that catches this**,
and it is not in `check:all`.

**Gate order:** `src/proxy.ts` runs the **API branch first** (auth only, 401/404, no redirect),
then next-intl → ack gate → auth gate for pages. Pinned by
`apps/studio/src/__snapshots__/route-gate-matrix.md`, which now discovers pages by walking for
`page.tsx` and handlers by walking for `route.ts` — a new route of either kind changes that
snapshot, and the change is the review signal.

**Run it:** `pnpm supabase start && ./scripts/seed/seed-demo-accounts.sh && pnpm dev`.
**Verify:** `pnpm check:all`, `pnpm build`, `pnpm depcruise`, `pnpm e2e`, `pnpm size`,
`uv run --directory python poe check`. Persistence/metering suites need a **Supabase** database.

**Housekeeping gotchas:**

- **One container runtime: Docker Desktop.** Colima's autostart is removed.
- **Live verification leaves storage objects behind.** Clean the bucket with the artist's token,
  not `service_role`.
- **Parallel worktrees cannot share a migration history** — `supabase db reset` per branch.
- **Clear `apps/*/.next` when switching between branches that add routes.**
- **`apps/studio/tsconfig.json` typechecks `e2e/`.** A Playwright spec is now a typecheck
  surface — that is deliberate, and it is what makes importing the API contract types load-bearing.
- **jsdom cannot put a file in a form.** `fireEvent.change(input, {target:{files:[…]}})` sets the
  wrapper property but not the internal slot `new FormData(form)` reads, and there is no
  `DataTransfer`. Read the file from the input's own `files`, not out of the `FormData`.
- **Next's route announcer is `role="alert"`.** A bare `getByRole('alert')` in Playwright is
  ambiguous after a navigation; match the error summary by accessible name.
- **`pnpm --filter … e2e -- --project=chromium` does not filter** — the passthrough is ignored and
  all three browsers run.
- **The pre-commit hook runs no ruff.** Run `uv run --directory python poe check` before pushing.
- Biome formats JSON, so a hand-written metrics record fails `format:check` until `pnpm format` —
  and a *generated* report must be formatted after it is generated, not before.
- **`pnpm lint:md` is red locally** on gitignored `docs/temp-references/`, which stops `check:all`
  before later checks run. Filed as
  [#35](https://github.com/lsr-explore/art-loupe/issues/35); run the checks individually meanwhile.
- **Review is Greptile, and its triggering is unreliable in both directions.** On #37 the first
  push drew an automatic review in ~4 minutes — a terminal `greptile review` started moments
  before it landed was wasted, and it **diffed against a stale base**, naming a file absent from
  the PR. Check the PR first, wait a few minutes, and confirm any finding is in
  `git diff origin/main...HEAD` before acting on it.
- **`gh api` writes need their body read back**, and `-F body=@file` — `-f` posts the literal
  filename and still answers 201 with an `html_url`.
