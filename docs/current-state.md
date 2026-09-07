# Current state

**Updated:** 2026-09-06

## 1. Snapshot

**Slice 1 is eight of fourteen PRs in.** The Python agent layer, the shared contracts, the
durable checkpointer, the cost ledger, the project/storage schema, the overlay primitives, and
now route-handler gating with complete artist deletion all exist as tested code.

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
| 9 | overlay primitives in `packages/fascia` | merged (#21) |
| 7, 8, 10-14 | upload · plates · CV · routing · interrupt · ops | **not started** |

### What works today

- **Three apps run and build**: `entry` (3003), `studio` (3001), `operations` (3000).
- **The click-through flow works end to end**: entry → acknowledge → launch → sign in.
- **Route handlers are gated.** `api` is inside the matcher and takes its own branch before
  locale negotiation; handlers answer in status codes, never redirects.
- **Artist deletion reaches the bytes.** Storage objects go before rows, and completeness is
  judged by end state rather than by a count of removals.
- **An interrupted run resumes in a different process**, against real Postgres.
- **Every node is metered and every run is capped** before the first paid call exists.
- **452 tagged tests, 0 untagged**, across Vitest, Playwright and pytest.

### What is *not* demoable, and should be said plainly

There is **no artist-facing product flow**. `studio/home` is a heading and a paragraph. The PR 9
overlay primitives render **nowhere** — exported from `fascia`, imported by no app, no Storybook.
No app calls any API route. Upload (PR 7) is the unlock: nothing downstream can be shown without
a photograph in the system.

**The graph runs no agent.** `graph.py` is `START → seed → END`, where `seed` returns a string;
there is **no LLM SDK anywhere in the workspace**. PR 12 adds the one model call in the slice.
After all fourteen PRs, slice 1 exercises the `measured` arm of the evidence union and nothing
that produces a `cited` one — no critique, no retrieval, no citations, no Plan Critic. That is a
deliberate spine-before-payload ladder, but "multi-agent" would overclaim what slice 1 shows.

### Open questions

- **The ack-cookie-lifetime question in [#27](https://github.com/lsr-explore/art-loupe/issues/27)
  is unanswered.** Recommendation recorded there (match the ack cookie to the session `ttl`);
  the call is Laurie's.
- **ADR numbering.** 0003 was taken by the deletion ADR; `settled-decisions.md`'s scope
  amendment, previously earmarked 0003, needs 0004.
- **`@artloupe/schemas` is still missing from `entry` and `operations`.** It was in no app's
  dependencies despite the previous state doc saying otherwise; only `studio` was fixed.
- **Dependabot groups are unrestricted** — `.github/dependabot.yml` groups by
  `dependency-type` with no `update-types`, so a framework major rides with patch bumps again
  on the next one.
- **`pnpm lint:md` is red locally** on gitignored `docs/temp-references/`; markdownlint's glob
  does not honour `.gitignore`, so `check:all` is unusable locally though CI is unaffected.
- **Vitest browser mode** is unfiled. Strong fit here — jsdom has no layout, so PR 9's 24px
  target sizes are unverifiable at component level — but it is a whole test-suite migration.
- The `.task` model licence, `flows.json` restructure, guard defaults, `BudgetExceeded → 429`,
  Spanish copy, chat credits, embedding model, materials corpus and gold set all remain as
  previously recorded.

### Read first

- [`CLAUDE.md`](../CLAUDE.md) · [`design/slice-1-build-plan.md`](./design/slice-1-build-plan.md)
- [`decision-records/0003-project-deletion-holds-the-artist-token.md`](./decision-records/0003-project-deletion-holds-the-artist-token.md)
- [`design/geometry-confidence-plan.md`](./design/geometry-confidence-plan.md) — binds PRs 10-12

## 2. Agent pickup notes

**State:** slice 1, PRs 1-6 and 9 of 14 merged. `main` at `3063618`. No open PRs. Issue #22
closed by #29. Backlog is GitHub issues on user project 3.

**Next step: PR 7** — upload + intake + EXIF/filename/OCR screening at ingest, with a fixture
fallback when `ARTLOUPE_AGENT_URL` is unset so Playwright stays hermetic.

**PR 7 is order-constrained, and getting it wrong fails loudly but misleadingly.** The object
must be uploaded **before** its `source_images` row is written. The storage INSERT policy refuses
a write to a key a row already cites (FR-105, issue #22), so creating the row first makes *every*
first upload fail with a bare permissions error that reads like a broken policy.
`test_the_guard_does_not_refuse_the_upload_that_creates_the_pair` exists to name the cause.

**Then PR 11 before PR 10** (approved 2026-09-05). PR 11 owns the `opencv-contrib-python`
dependency and the one-`cv2`-provider hygiene test. A worktree is prepared and rebased at
`worktrees/feat/line-vp-detection/art-loupe`; it needs `uv sync --all-packages` before pytest.

**Scope is settled.** Art Loupe = reference photo → medium-aware working plan. Never generates
imagery. Artwork critique is **cut**; the **Plan Critic** (evaluator over the plan) is **kept**.

**Load-bearing invariants** — unchanged, plus two from this session:

- Every claim is `measured` | `cited` | `chosen`; an artist assertion is never evidence.
- Only `confirmed` / `adjusted` regions reach measurement.
- Chat credits and the plan budget are separate ledgers.
- `interrupt()` sits **alone** in its node, or resume double-charges the ledger.
- Checkpoints live in the `langgraph` schema via `options=-csearch_path=langgraph,public`.
- **An original is immutable against every verb**, at both layers: no UPDATE policy or grant and
  no DELETE on `source_images`, *and* the storage INSERT policy refuses a second write to a
  claimed key.
- **Deletion is two systems and cannot be one transaction.** `protect_objects_delete` refuses
  direct SQL deletion from `storage.objects` for every role. Objects before rows; judge
  completeness by end state, because storage answers `200 []` for an already-absent key.
- **No app runtime holds `service_role`.** The deletion path uses the artist's token.
- Confidence must measure the detector, never the sitter.

**Stack:** pnpm workspaces + uv workspace (`libs/auth|schemas|persistence|metering`,
`services/agent`). Next 16 / React 19 — read `node_modules/next/dist/docs/` first. Node 24,
pnpm 10.0.0, **vitest 5**.

**Gate order:** `src/proxy.ts` runs the **API branch first** (auth only, 401/404, no redirect),
then next-intl → ack gate → auth gate for pages. Pinned by
`apps/studio/src/__snapshots__/route-gate-matrix.md`, which discovers handlers off disk.

**Run it:** `pnpm supabase start && ./scripts/seed/seed-demo-accounts.sh && pnpm dev`.
**Verify:** `pnpm check:all`, `pnpm build`, `pnpm depcruise`, `pnpm e2e`,
`uv run --directory python poe check`. Persistence/metering suites need a **Supabase** database.

**Housekeeping gotchas:**

- **One container runtime: Docker Desktop.** Colima's autostart is removed.
- **Parallel worktrees cannot share a migration history** — `supabase db reset` per branch.
- **Clear `apps/*/.next` when switching between branches that add routes**, or `tsc` fails on a
  stale `.next/types/validator.ts` referencing a route the branch does not have.
- **Pass extra args through pnpm scripts with `--`** — `pnpm --filter <pkg> test -- -u`. Without
  it pnpm swallows the flag and prints its own help.
- **The pre-commit hook runs no ruff.** Run `uv run --directory python poe check` before pushing.
- Biome formats JSON, so a hand-written metrics record fails `format:check` until `pnpm format`.
- **Review is Greptile, and its triggering is unreliable** — it fired on a first push and not on
  the next. Confirm which commit a review actually read before calling a branch reviewed, and
  check findings against `git diff origin/main`: one CLI review diffed against a stale base.
  `.claude/skills/ship/SKILL.md` was corrected for this in #30.
- **Two merged remote branches were not auto-deleted**: `origin/feat/route-gating-and-deletion`,
  `origin/fix/ship-skill-review-and-comment-flags`.
