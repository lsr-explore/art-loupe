# Current state

**Updated:** 2026-09-07

## 1. Snapshot

**Slice 1 is nine of fourteen PRs in.** The Python agent layer, the shared contracts, the
durable checkpointer, the cost ledger, the project/storage schema, the overlay primitives,
route-handler gating with complete artist deletion, and now the **ingest path** all exist as
tested code.

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
| 9 | overlay primitives in `packages/fascia` | merged (#21) |
| 7b, 8, 10-14 | intake form · plates · CV · routing · interrupt · ops | **not started** |

### What works today

- **An artist can upload.** `POST /api/projects` takes a photograph and a `ProjectIntent`,
  stores the original immutably, and returns a project. Verified end to end against the live
  stack with a real token, not only against mocks.
- **Untrusted text is screened at ingest** on three of five surfaces — filename, EXIF, and the
  artist's free-text goal. Detections are recorded by surface in `screening_detections`.
- **The two unscreened surfaces are written down**, not omitted: a `surface-not-screened`
  sentinel row keeps the operations panel from implying coverage of a surface nothing read.
- **Route handlers are gated**, and artist deletion reaches the bytes.
- **An interrupted run resumes in a different process**, against real Postgres.
- **Every node is metered and every run is capped** before the first paid call exists.
- **639 tagged tests, 0 untagged**, across Vitest, Playwright and pytest.

### What is *not* demoable, and should be said plainly

There is **still no artist-facing UI for any of this**. The upload route has no form in front of
it — `studio/home` is a heading and a paragraph, and the PR 9 overlay primitives render nowhere.
PR 7b is the unlock, and it opens with a real problem (below).

**The graph still runs no agent.** `graph.py` is `START → seed → END`; there is no LLM SDK
anywhere in the workspace. PR 12 adds the one model call in the slice. After all fourteen PRs,
slice 1 exercises the `measured` arm of the evidence union and nothing that produces a `cited`
one — no critique, no retrieval, no citations, no Plan Critic. Deliberate spine-before-payload,
but "multi-agent" would overclaim what slice 1 shows.

### Open questions

- **PR 7b's e2e path is blocked and needs a decision first.** The hermetic Playwright run uses
  `AUTH_PROVIDER=demo`; a demo session carries no Supabase token, so `getAccessToken()` returns
  null and the upload route answers 401. A Playwright upload spec needs either a live Supabase
  or a seam the demo provider can satisfy. Decide at the top of 7b, not at the end.
- **The ack-cookie-lifetime question in [#27](https://github.com/lsr-explore/art-loupe/issues/27)
  is still unanswered.** Recommendation recorded there; the call is Laurie's.
- **ADR numbering.** 0003 is the deletion ADR; `settled-decisions.md`'s scope amendment needs 0004.
- **`docs/backlog/critical-path.md` is stale inherited material** — dated 2026-08-01, traced
  against a commit not in this repository, citing issues #225/#226/#229 that do not exist here.
  Refresh or delete; it is a proposal document and the sequencing is Laurie's.
- **Four newly filed issues are deliberately unparented** (#32, #33, #34, #36). Epic #5 is scoped
  to static-analysis tooling and only #35 is that. Two epics suggest themselves — slice-1 safety
  completion, and workspace/dependency hygiene — each currently holding one or two issues.
- The `.task` model licence, `flows.json` restructure, guard defaults, `BudgetExceeded → 429`,
  Spanish copy, chat credits, embedding model, materials corpus and gold set all remain as
  previously recorded.

### Read first

- [`CLAUDE.md`](../CLAUDE.md) · [`design/slice-1-build-plan.md`](./design/slice-1-build-plan.md)
- [`decision-records/0003-project-deletion-holds-the-artist-token.md`](./decision-records/0003-project-deletion-holds-the-artist-token.md)
- [`design/geometry-confidence-plan.md`](./design/geometry-confidence-plan.md) — binds PRs 10-12

## 2. Agent pickup notes

**State:** slice 1, PRs 1-6, 7a and 9 of 14 merged. `main` at `4f5d663`. No open PRs. No
worktrees — the `feat/line-vp-detection` one was removed as empty. Backlog is GitHub issues on
user project 3; issues #32-#36 filed 2026-09-07.

**Next step: PR 7b** — the intake form, its i18n copy, and the e2e spec. **Answer the demo-auth
question before writing the form**, not after: `AUTH_PROVIDER=demo` yields no Supabase token, so
the upload route answers 401 and a hermetic Playwright upload cannot reach it as things stand.

**Then PR 11 before PR 10** (approved 2026-09-05). PR 11 owns the `opencv-contrib-python`
dependency and the one-`cv2`-provider hygiene test. Its worktree was removed; recreate with
`wt new` against current `main` rather than looking for the old one.

**Scope is settled.** Art Loupe = reference photo → medium-aware working plan. Never generates
imagery. Artwork critique is **cut**; the **Plan Critic** is **kept**.

**Load-bearing invariants** — unchanged, plus five from this session:

- Every claim is `measured` | `cited` | `chosen`; an artist assertion is never evidence.
- Only `confirmed` / `adjusted` regions reach measurement.
- Chat credits and the plan budget are separate ledgers.
- `interrupt()` sits **alone** in its node, or resume double-charges the ledger.
- Checkpoints live in the `langgraph` schema via `options=-csearch_path=langgraph,public`.
- **An original is immutable against every verb**, at both layers.
- **Deletion is two systems and cannot be one transaction.** Objects before rows; judge
  completeness by end state.
- **Ingest runs the opposite order: object BEFORE the row that cites it.** The storage insert
  policy refuses a write to a key a `source_images` row already claims, so row-first makes every
  first upload fail with a bare permissions error that reads like a broken policy.
- **No app runtime holds `service_role`.** Every storage and PostgREST call uses the artist's token.
- **The screener's rules are data, not code.** One fixture, two hand-authored implementations, one
  shared case corpus, and a mechanically enforced regex portability subset — the likely failure is
  a pattern that compiles on both sides and matches on only one.
- **A surface nothing screened is a row, not an absence.** An absent row is indistinguishable from
  a clean one.
- **A detection is a record.** `screening_detections` has no UPDATE and no DELETE.
- Confidence must measure the detector, never the sitter.

**Stack:** pnpm workspaces + uv workspace (`libs/auth|schemas|persistence|metering`,
`services/agent`). Next 16 / React 19 — read `node_modules/next/dist/docs/` first. Node 24,
pnpm 10.0.0, **vitest 5**. `apps/studio` now also carries `exifr` and `image-size` (pure JS).

**Gate order:** `src/proxy.ts` runs the **API branch first** (auth only, 401/404, no redirect),
then next-intl → ack gate → auth gate for pages. Pinned by
`apps/studio/src/__snapshots__/route-gate-matrix.md`, which discovers handlers off disk — a new
route handler changes that snapshot, and the change is the review signal.

**Run it:** `pnpm supabase start && ./scripts/seed/seed-demo-accounts.sh && pnpm dev`.
**Verify:** `pnpm check:all`, `pnpm build`, `pnpm depcruise`, `pnpm e2e`,
`uv run --directory python poe check`. Persistence/metering suites need a **Supabase** database.

**Housekeeping gotchas:**

- **One container runtime: Docker Desktop.** Colima's autostart is removed.
- **Live verification leaves storage objects behind.** Deleting project *rows* never removes
  bucket objects — that is the whole two-systems design — and leftovers break
  `test_an_artist_sees_only_objects_under_their_own_prefix`, whose `both == 2` control is what
  catches it. Clean the bucket with the artist's token, not `service_role`.
- **Parallel worktrees cannot share a migration history** — `supabase db reset` per branch.
- **Clear `apps/*/.next` when switching between branches that add routes.**
- **Pass extra args through pnpm scripts with `--`** — `pnpm --filter <pkg> test -- -u`.
- **The pre-commit hook runs no ruff.** Run `uv run --directory python poe check` before pushing.
- Biome formats JSON, so a hand-written metrics record fails `format:check` until `pnpm format` —
  and a *generated* report must be formatted after it is generated, not before.
- **`pnpm lint:md` is red locally** on gitignored `docs/temp-references/`, which stops `check:all`
  before i18n, traceability, contrast, typecheck and tests ever run. Filed as
  [#35](https://github.com/lsr-explore/art-loupe/issues/35); run the checks individually meanwhile.
- **Review is Greptile, and its triggering is unreliable.** On #31 no automatic review arrived for
  ~13 minutes, the CLI run then errored server-side mid-run — `greptile review show <id>` recovered
  it in full — and the automatic review that did land covered only the first fix commit. **A fix
  commit does not get reviewed by the review that prompted it**: two of #31's four findings were
  defects in its own fixes, and the last was found only by a second deliberate review.
- **`gh api` writes need their body read back.** A 201 with an `html_url` proves a comment was
  created, not that it says anything — and a verification helper wrapped in a shell function can
  lose `gh` from `PATH` and fail *open*, printing "verified" for comments that do not exist.
