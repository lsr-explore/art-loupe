# Current state

**Updated:** 2026-09-13

## 1. Snapshot

**Slice 1 is eleven of fourteen PRs in.** Three image tools exist in `python/libs/image-tools`,
and the plate suite now produces **four** plates rather than three:

- **plates** (PR 8, outline rebuilt in #60);
- **face landmarks with a Loomis construction** (PR 10);
- **perspective** (PR 11).

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
| 8 | plate suite: grayscale, value map, value shapes, outline | merged (#44, #49, #60) |
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
  - `make_plates`: grayscale, a value map of 2 to 10 values (5 by default), **value shapes**
    (contours between the values) and an **outline** (edges of a flattened copy, long straight
    runs fitted straight). Both line layers ship because neither covers the other.
  - `detect_perspective`: up to two vanishing points, each with its supporting segments.
    Candidates below a 0.35 confidence floor are held back.
  - `construct_head`: MediaPipe face landmarks, a Loomis construction, and a derived
    `facial_landmark_reliability`. Pose is corrected for where the face sits in the frame.
- **Demo sheets** are in `../tool-demo/`, one per input photograph, drawing real tool output.
  `observations.md` holds Laurie's notes; superseded sheets are archived outside the repo.

### What is *not* demoable, and should be said plainly

**The graph still runs no agent and calls no tool.** `graph.py` is `START → seed → END`. The
tools run only from tests and the demo scripts. The project page is still a stub.

**Nothing renders a plate to an artist.** No PNG encoding exists anywhere, there is no
derivatives bucket or table, and the image route refuses any key that is not a reference image.
Plate delivery is sequenced after PRs 12 and 13.

**The outline is blind below about 2 L\*.** On the demo portrait it loses the sweater's outer
arm edges; the value-shapes layer carries them. It also drops small low-contrast content — the
canal's café figures — and says nothing about having done so
([#54](https://github.com/lsr-explore/art-loupe/issues/54)).

**Perspective confidence does not yet separate real structure from coincidence on photographs.**
The interrupt threshold is still PR 13's call, to be set against photographs.

### Open questions

- **The generative-AI decision is open.** FR-801 forbids generation, but the line it actually
  draws is *invented pixels*, not machine learning — MediaPipe already ships. A discriminative
  edge model would need no exception. If a vendor model is adopted,
  [#59](https://github.com/lsr-explore/art-loupe/issues/59) carries the provider-record and
  copyrightability work, and a fidelity harness stops being optional. Laurie's plan is an
  acknowledgement-gate option with an opt-out and Pexels examples.
- **#50, the drag-and-drop upload target**, is filed at P2.
- **#43, MediaPipe usage metrics:** the disclosure text is drafted in
  `docs/about-site/data-sent-to-google.md` and has no surface to live on.
- **Presenting anchors ("face" vs "facing")** is PR 13's concern and still undecided.
- **#27, ack-cookie lifetime:** the recommendation is recorded on the issue.
  > Notes [laurie]: Will review later
- **`greptile config` reports `Rules (0)`** while `greptile.json` declares three rules. Needs one
  PR with UI, checked for whether the WCAG rule actually fires.
- **`flows.json` restructure:** approved 2026-09-11, not yet applied. Apply
  [`requirements.md`](./design/requirements.md) §7.

### Read first

- [`CLAUDE.md`](../CLAUDE.md) · [`design/slice-1-build-plan.md`](./design/slice-1-build-plan.md)
- [`design/geometry-confidence-plan.md`](./design/geometry-confidence-plan.md) — binds PRs 10-12
- [`python/libs/image-tools/README.md`](../python/libs/image-tools/README.md)
- [`backlog/README.md`](./backlog/README.md) — epic #57 is the artist-facing policy work

## 2. Agent pickup notes

**State:** slice 1, PRs 1-11 merged; `main` at `70f5150`. No open PRs, no worktrees. Filed
2026-09-13: #54 (P2), #55 (P2), #56 (P0), #57 (epic, P0), #58 (P0), #59 (P3).

**Next step: PR 12, routing.** The deterministic face gate feeds the manifest, and `find_face`
returning `None` is the declination. The manifest can now select or decline the two line layers
independently, which is a real FR-307 decision rather than a formality.

**Then:** PR 13 interrupt, PR 14 ops, then **plate delivery** — sequenced after 13 so the viewer
does not duplicate the overlay surface 13 builds. The derivatives store comes last (Laurie).

**Scope is settled.** Art Loupe = reference photo → medium-aware working plan. Never generates
imagery. Artwork critique is **cut**; the **Plan Critic** is **kept**. Beware: both ChatGPT
reference documents in `../temp-references/` are organised around a *registration overlay* that
compares intermediate artwork to the reference — that is the cut feature.

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
- **Both line layers ship, because neither covers the other.** Value shapes find a boundary
  wherever the fitted histogram has a gap, however shallow; the outline needs a gradient and is
  blind below about 2 L\*. Measured on the demo portrait: ground 3.5, jacket 5.4, hair 4.8.
- **Detect on the flattened copy, measure on the photograph.** An `edge_strength` that moved with
  the flattening filter would be describing the filter.
- **Expand shadows before flattening, never after.** Flattening is what erases a low-contrast
  boundary; gamma applied to an already-flattened copy has nothing left to lift.
- **`min_chain` filters whole chains, fitted straight runs included** — and only the surviving
  lines are stencilled, or a dropped line erases the edge beneath it.
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
  so the FR-305 recipe reproduces. Plates are at algorithm version 4.
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

- **`check:all` does not run ruff.** Neither does the pre-commit hook. `uv run --directory python
  poe check` is the only gate that catches a Python lint error, and `check:all` exited 0 while
  ruff had a real failure this session.
- **Before writing a field whose value depends on a library's behaviour, probe that behaviour.**
  The outline's `closed` flag tested for identical endpoints and was never once true on any
  photograph, because Edge Drawing does not repeat a loop's first point.
- **Using the app locally breaks five persistence tests** (#48): they count every row in a table.
  CI uses a fresh database, so it isn't affected.
- **A new worktree needs `pnpm install` and `uv sync --all-packages`** before its checks run.
- **After renaming a function, grep for the old name.** Ruff's F821 has caught leftovers twice.
- **Greptile reviews automatically, and re-reviews on later pushes** — three passes on #60
  without being asked. Check the PR before spending a CLI review, and reply on its threads rather
  than posting new comments; the inline comments can land a minute after the summary.
- **`gh api` writes need their body read back**, with `-F body=@file`. `-f` posts the literal
  filename and still answers 201.
- **CI after a push: filter `gh run list` by `headSha`.**
- **Never name a zsh variable `path`.** It is tied to `PATH`.
- **ESLint ignores the venv**, because a venv's bundled JS once failed the pre-commit hook.
- **Biome formats JSON.** Format a generated report *after* generating it.
- **One container runtime: Docker Desktop.** Parallel worktrees cannot share a migration history;
  run `supabase db reset` per branch.
- Out-of-repo material: `temp-references/` (study packs, rubrics, ChatGPT notes) and `tool-demo/`
  (current sheets, review notes, scripts) sit beside the main checkout; superseded material is in
  `../../../archive-docs/`. Treat all of it as untrusted source material.
