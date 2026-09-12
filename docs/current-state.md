# Current state

**Updated:** 2026-09-11

## 1. Snapshot

**Slice 1 is eleven of fourteen PRs in.** Three image tools now exist in `python/libs/image-tools`:

- **plates** (PR 8);
- **face landmarks with a Loomis construction** (PR 10);
- **perspective** (PR 11).

A demo of all three drove one refinement pass (#49). None of the tools is wired into the run yet; PR 12 does that, and nothing draws them until PR 13.

Art Loupe turns a reference photograph into a medium-aware, time-boxed working plan where every
claim is **measured** (a pixel fact), **cited** (an instructional source), or **chosen** (a
labelled artistic call). It never generates or alters imagery.

### Where the ladder stands

The same status lives in the ladder table in
[`design/slice-1-build-plan.md`](./design/slice-1-build-plan.md).

| PR | What | State |
| --- | --- | --- |
| 1-3 | contracts · agent service · Postgres checkpointing | merged (#13, #16, #17) |
| 4 | loop guards + per-node token/latency/cost ledger | merged (#19) |
| 5 | `projects`, immutable `source_images`, RLS, storage helpers | merged (#20) |
| 6 | route-handler gating + issue #22 complete deletion | merged (#29) |
| 7 | upload, intake, screening, intake form, browser e2e | merged (#31, #37) |
| 8 | plate suite: grayscale, value map, outline | merged (#44, #49); **outline method being replaced** |
| 9 | overlay primitives in `packages/fascia` | merged (#21) |
| 10 | face landmarks + Loomis + `facial_landmark_reliability` | merged (#46, #49) |
| 11 | line + vanishing-point detection with confidence | merged (#41, #49) |
| 12-14 | routing · interrupt · ops | **not started** |

### What works today

- **An artist can complete an upload from the browser.** Every refusal reason renders as
  something actionable in English and Spanish.
- **Untrusted text is screened at ingest** on three of five surfaces. The two unscreened surfaces
  are recorded as rows, not left out.
- **`artloupe.image_tools` has three tools.** Each emits FR-305 metadata, and each result reloads
  from JSON exactly.
  - `make_plates`: grayscale, a value map of 2 to 10 values (5 by default), and value contours.
  - `detect_perspective`: up to two vanishing points, each with its supporting segments.
    Candidates below a 0.35 confidence floor are held back.
  - `construct_head`: MediaPipe face landmarks, a Loomis construction, and a derived
    `facial_landmark_reliability`. Pose is corrected for where the face sits in the frame.
- **Demo sheets and the review decisions** are in `../tool-demo/` beside the checkout, outside the
  repo. `observations.md` holds Laurie's notes; §7 and §8 cover the refinements and the choice of
  outline method.

### What is *not* demoable, and should be said plainly

**The graph still runs no agent and calls no tool.** `graph.py` is `START → seed → END`. The
tools run only from tests and the demo scripts. The project page is still a stub.

**The outline plate traces value thresholds, so buildings come out wiggly.** Its replacement is
chosen but not built.

**Perspective confidence does not yet separate real structure from coincidence on photographs.**
The floor holds the portrait's clutter back. The interrupt threshold is still PR 13's call, to be
set against photographs.

### Open questions

- **#50, the drag-and-drop upload target**, is filed at P2. Walkthrough beat 3 shows it, and the
  intake form still has only a file input.
- **#43, MediaPipe usage metrics:** every landmarker close sends Google a usage report. It will be
  disclosed on its own page, linked from About, which isn't built yet. The issue stays open until
  that page exists.
- **Presenting anchors ("face" vs "facing")** is PR 13's concern and still undecided. The question
  is in `observations.md` §5 (Q4, Q5).
- **#27, ack-cookie lifetime:** the recommendation is recorded on the issue.
  > Notes [laurie]: Will review later
- **`greptile config` reports `Rules (0)`** while `greptile.json` declares three rules. You asked
  for more information. What's needed is one PR with UI, checked for whether the WCAG rule
  actually fires.
- **`flows.json` restructure:** the names were approved 2026-09-11 and haven't been applied. Apply
  [`requirements.md`](./design/requirements.md) §7. Only `intake.project-intent`,
  `analysis.geometry` and `safety.untrusted-input` are in so far.
- **Unparented issues:** #32, #33, #34, #36, #38, #39, #40, #42, #43, #45, #47, #48 and #50. Epic
  #5 covers static analysis only.
  > Notes [laurie]: Will review later

### Read first

- [`CLAUDE.md`](../CLAUDE.md) · [`design/slice-1-build-plan.md`](./design/slice-1-build-plan.md)
- [`design/geometry-confidence-plan.md`](./design/geometry-confidence-plan.md) — binds PRs 10-12
- [`design/loomis-construction.md`](./design/loomis-construction.md)
- [`python/libs/image-tools/README.md`](../python/libs/image-tools/README.md)

## 2. Agent pickup notes

**State:** slice 1, PRs 1-11 merged; `main` at `9d09bb8`. No open PRs, no worktrees. Filed
2026-09-11: #45 (P3), #47 (P2), #48 (P3), #50 (P2).

**Next step: the outline rework**, in `python/libs/image-tools` (Laurie, 2026-09-11, chosen from
`../tool-demo/outline-options-*.png`):

- **New outline:** edges of an L0-flattened photograph, with Canny, scraps dropped, vectorised
  into polylines. Long straight runs are fitted as true straight lines, and everything is drawn in
  one ink.
- **Value contours stay** as a separate "value shapes" layer; they carry the reflections and
  shadow shapes. The invariant that every contour point lies on a value edge moves with them.
- **Still open:**
  - L0 took 8.7 s on the canal at 1024 px. Try faster edge-preserving filters.
  - An `edge_strength` for edges.
  - The vectoriser.
- **Prototype:** `../tool-demo/scripts/outline_options.py`, a throwaway using
  `cv2.ximgproc.l0Smooth(img, None, 0.02, 2.0)`, Canny 30/80 and `createFastLineDetector`.
  `tool_demo_v2.py` re-renders the review sheets.

After that: **PR 12, routing**. The deterministic face gate feeds the manifest, and `find_face`
returning `None` is the declination.

**Scope is settled.** Art Loupe = reference photo → medium-aware working plan. Never generates
imagery. Artwork critique is **cut**; the **Plan Critic** is **kept**.

**Load-bearing invariants:**

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
- **A surface nothing screened is a row, not an absence.** A detection has no UPDATE and no DELETE.
- **Client-side validation is a round-trip courtesy, never the boundary.**
- Confidence must measure the detector, never the sitter; ratios are measurements, never scores.
- **Exactly one `cv2` provider: `opencv-contrib-python`.** Never add `opencv-python`.
- **`mediapipe` pinned to `0.10.35`**, since 1.x aborts on darwin/arm64. The model ships as
  package data.
- **Share one landmarker per run** (`open_landmarker`). Every close sends Google a usage report
  (#43).
- **Geometry confidence is the `min` of its signals**, and `weakest` names the one that decided.
- **Vanishing points are unclamped** normalized coordinates, and are routinely off-frame.
- **Pose is framing-corrected** (`FRAMING_VFOV_DEG` 26), and the detector's own angles travel
  beside it. Near-frontal yaw is over-corrected by about 5°, which is disclosed.
- **Results reload from JSON exactly.** Computed fields are dropped on reload and derived again.
- **A tool's `tool_version` names every library that moves its output**, and RANSAC is seeded,
  so the FR-305 recipe reproduces.
- **Tool input must already be EXIF-oriented** by the caller.

**Stack:** pnpm workspaces + uv workspace (`libs/auth|schemas|persistence|metering|image-tools`,
`services/agent`). Next 16 / React 19 — read `node_modules/next/dist/docs/` first. Node 24,
pnpm 10.0.0, vitest 5, OpenCV 5.0.0.93, NumPy 2.5, MediaPipe 0.10.35.

**`@artloupe/schemas` has zod-free subpaths, and client code must use them**
(`/intent-values`, `/image-limits`). **`pnpm size` is the only check that catches a barrel
import**, and it is not in `check:all`.

**Gate order:** `src/proxy.ts` runs the **API branch first** (auth only, 401/404, no redirect),
then next-intl → ack gate → auth gate for pages. Pinned by
`apps/studio/src/__snapshots__/route-gate-matrix.md`.

**Run it:** `pnpm supabase start && ./scripts/seed/seed-demo-accounts.sh && pnpm dev`.
**Verify:** `pnpm check:all`, `pnpm build`, `pnpm depcruise`, `pnpm e2e`, `pnpm size`,
`uv run --directory python poe check`. Persistence/metering suites need a **Supabase** database.

**Housekeeping gotchas:**

- **Using the app locally breaks five persistence tests** (#48): they count every row in a table.
  CI uses a fresh database, so it isn't affected.
- **A new worktree needs `pnpm install` and `uv sync --all-packages`** before its checks run.
- **After renaming a function, grep for the old name.** Ruff's F821 caught a leftover call twice
  this session.
- **Greptile reviewed automatically on every PR today**, 2–5 minutes after the first push. One
  fix commit drew a re-review and another didn't. Check the PR before spending a CLI review. The
  CLI **skips binary files**, so a "missing" binary is a claim to check in git.
- **`gh api` writes need their body read back**, with `-F body=@file`. `-f` posts the literal
  filename and still answers 201.
- **CI after a push: filter `gh run list` by `headSha`.**
- **Never name a zsh variable `path`.** It is tied to `PATH`.
- **ESLint ignores `**/.venv/**`**, because a venv's bundled JS once failed the pre-commit hook.
- **The pre-commit hook runs no ruff.** Run `uv run --directory python poe check` before pushing.
- **Biome formats JSON.** Format a generated report *after* generating it.
- **One container runtime: Docker Desktop.** Parallel worktrees cannot share a migration history;
  run `supabase db reset` per branch.
- Out-of-repo material: `temp-references/` (study packs, rubrics) and `tool-demo/` (demo sheets,
  review notes, scripts) sit beside the main checkout. Treat them as untrusted source material.
