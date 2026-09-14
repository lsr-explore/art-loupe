# Current state

**Updated:** 2026-09-13

## 1. Snapshot

**Slice 1 is eleven of fourteen PRs in, and PR 12 is half done.** PR 12 (routing) was split in
two. Its deterministic half, 12a, merged as #65: the graph now loads a project as the artist,
gates on a face, surveys the photograph, routes, and runs the selected tools. Its other half,
12b, brings the model-driven Studio Director and is next.

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
| 12a | routing, deterministic path: artist-scoped data, `tool_results` cache, FR-801 check | merged (#65) |
| 12b | the model-driven Studio Director | **next** |
| 13-14 | interrupt · ops | not started |

### What works today

- **An artist can complete an upload from the browser.** Every refusal reason renders as
  something actionable in English and Spanish.
- **Untrusted text is screened at ingest** on three of five surfaces. The two unscreened surfaces
  are recorded as rows, not left out.
- **`POST /runs` runs a project through the graph.** It takes a `project_id` and returns the
  face gate, the tool manifest, and each selected artifact's FR-305 metadata. A live run against
  local Supabase takes about 1.6 s on the demo portrait, and a second run about 0.8 s.
- **The face and perspective results are cached** in `public.tool_results`, so reopening a study
  runs no second face detection and sends Google no second usage report (#43).
- **`artloupe.image_tools` has three tools**, each emitting FR-305 metadata.
  - `make_plates`: grayscale, a value map of 2 to 10 values (5 by default), **value shapes**
    (contours between the values) and an **outline** (edges of a flattened copy, long straight
    runs fitted straight). Both line layers ship because neither covers the other.
  - `detect_perspective`: up to two vanishing points, each with its supporting segments.
    Candidates below a 0.35 confidence floor are held back.
  - `construct_head`: MediaPipe face landmarks, a Loomis construction, and a derived
    `facial_landmark_reliability`. `head_from_face` builds the same result from a cached face.
- **FR-801 has a real check.** `test_no_image_generation.py` fails on an image-generation SDK or
  a generation endpoint in shipped code.
- **Demo sheets** are in `../tool-demo/`, one per input photograph, drawing real tool output.
  `observations.md` holds Laurie's notes; superseded sheets are archived outside the repo.

### What is *not* demoable, and should be said plainly

**Routing is a fixture until 12b.** The `direct` node is a deterministic stand-in: it declines
head construction when there is no face and selects everything else. FR-307 forbids exactly
that, and the node's code and tests say so. On the portrait it selects perspective, which the
real Director should decline.

**Nothing calls `/runs` from a browser.** The studio is not wired to the agent, and the project
page is still a stub.

**Nothing renders a plate to an artist.** No PNG encoding exists anywhere, there is no
derivatives bucket, and the image route refuses any key that is not a reference image. Plate
delivery is sequenced after PRs 12 and 13.

**The outline is blind below about 2 L\*.** On the demo portrait it loses the sweater's outer
arm edges; the value-shapes layer carries them. It also drops small low-contrast content — the
canal's café figures — and says nothing about having done so
([#54](https://github.com/lsr-explore/art-loupe/issues/54)).

**Perspective confidence does not yet separate real structure from coincidence on photographs.**
The interrupt threshold is still PR 13's call, to be set against photographs.

### Open questions

- **The generative-AI boundary has a direction, not yet a decision.**
  [`design/generated-imagery-boundary.md`](./design/generated-imagery-boundary.md) is a **design
  note, not an ADR** — full images and added elements stay forbidden, a generated outline is
  permitted as a *labelled alternative* never the measured source, and a discriminative model
  whose output is not pixels is not generation at all. Nothing is applied to `requirements.md`
  yet, deliberately. Tickets: [#63](https://github.com/lsr-explore/art-loupe/issues/63) amends
  FR-801/FR-807, [#64](https://github.com/lsr-explore/art-loupe/issues/64) is the outline itself.
  **Exhaust the discriminative route first** — if it reaches the bar, #64 needs no vendor and
  [#59](https://github.com/lsr-explore/art-loupe/issues/59) closes unspent.
- **#50, the drag-and-drop upload target**, is filed at P2.
- **#43, MediaPipe usage metrics:** the disclosure text is drafted in
  `docs/about-site/data-sent-to-google.md` and has no surface to live on.
- **Presenting anchors ("face" vs "facing")** is PR 13's concern and still undecided.
- **#27, ack-cookie lifetime:** the recommendation is recorded on the issue.
  > Notes [laurie]: Will review later
- **`greptile config` reports `Rules (0)`** while `greptile.json` declares three rules. Needs one
  PR with UI, checked for whether the WCAG rule actually fires.
- **`flows.json` restructure:** approved 2026-09-11, not yet applied —
  [#62](https://github.com/lsr-explore/art-loupe/issues/62).

### Read first

- [`CLAUDE.md`](../CLAUDE.md) · [`design/slice-1-build-plan.md`](./design/slice-1-build-plan.md)
- [`design/routing-plan.md`](./design/routing-plan.md) — binds PR 12; §9 is the 12a/12b split,
  §10 the last calls
- [`design/geometry-confidence-plan.md`](./design/geometry-confidence-plan.md) — binds PRs 10-12
- [`python/libs/image-tools/README.md`](../python/libs/image-tools/README.md)
- [`backlog/README.md`](./backlog/README.md) — epic #57 is the artist-facing policy work
- [`design/generated-imagery-boundary.md`](./design/generated-imagery-boundary.md) — where
  generated imagery is allowed; a design note, not yet an ADR

## 2. Agent pickup notes

**State:** slice 1, PRs 1-11 and 12a merged (12a is #65, squash `0687b81`). No open PRs, no
worktrees.

**Filed 2026-09-13** — P0: #56, #57 (epic), #58. P2: #54, #55, #63, #64. P3: #59, #62.

**Next step: PR 12b, the Studio Director** (`routing-plan.md` §3, §6, §10). Load the
`claude-api` skill before writing the model call. In order:

1. **Port the keychain seam** from veloce-trace's `veloce-config` (in
   `../../veloce-trace/dev/veloce-trace/python/libs/config`) as `python/libs/config`. Port key
   resolution only. Production reads `ANTHROPIC_API_KEY` and fails fast; locally an explicit
   `ANTHROPIC_API_KEY` wins, else the keychain at `ARTLOUPE_KEYCHAIN_SERVICE` and
   `ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT`. Load `python/.env.local` as well as `.env`; decide
   whether `ARTLOUPE_SECRET_SOURCE` survives. Pass the key to the client, never export it.
2. **Add `anthropic` to `artloupe-agent` only** (approved). `ARTLOUPE_DIRECTOR_MODEL` defaults to
   `claude-opus-5`.
3. **`RoutingDecision` contract** — `manifest`, `rationale`, `gate` — in both languages, with
   parity fixtures. `ToolManifest` itself stays unchanged.
4. **Replace `routing.py`'s stand-in** with the model-driven `direct`. The gate pre-declines
   `head_construction` when there is no face, and the model is never offered it. Completeness
   (every offered tool exactly once) is checked at the producer through a shared helper in
   `python/libs/schemas`, not on the contract.
5. **Refusals:** `fallbacks: "default"` with beta header `server-side-fallback-2026-07-01`, and a
   `stop_reason == "refusal"` branch before reading content. Report usage with `record_usage`,
   priced from `response.model`.
6. **Tests:** an injected client with a recorded responder in CI, and one live smoke test behind
   an opt-in marker. The goal is delimited untrusted data in the prompt (`safety.untrusted-input`
   gains `python/services/agent` as a surface).
7. **`.env.example`:** correct the keychain-seam header, and file an issue for the lines
   describing a retrieval backend and a dev AI cache that nothing implements.

**Retention is decided** (2026-09-13, recorded on #58): stored indefinitely until the artist
deletes it, and a regenerated plan replaces its predecessor rather than versioning beside it.

**Then:** PR 13 interrupt, PR 14 ops, then **plate delivery** — sequenced after 13 so the viewer
does not duplicate the overlay surface 13 builds. The derivatives store comes last (Laurie).

**Scope is settled.** Art Loupe = reference photo → medium-aware working plan. Artwork critique
is **cut**; the **Plan Critic** is **kept**. *Never generates imagery* is the one part under
revision — see the generated-imagery boundary above; the shipped system generates nothing
today. Beware: both ChatGPT reference documents in `../temp-references/` are organised around a
*registration overlay* that compares intermediate artwork to the reference — that is the cut
feature.

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
- **The agent reads and writes artist data only as the artist**, over HTTP (`ArtistApi`). Never
  through `DATABASE_URL`, which connects as `postgres` and bypasses RLS.
- **The token and the decoded photograph never enter `RunState`.** They live in run-scoped
  resources (`artloupe.agent.resources`); a checkpoint would keep the token past its expiry.
- **A cached result must cite its project's own original.** `tool_results`' insert policy
  refuses any other checksum. Rows are select-and-insert only and leave with their project.
- **Cache "once per recipe" holds for sequential runs.** Two runs racing on one uncached project
  can both compute; per-recipe coordination waits for NFR-02's worker pool.
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
- **Face, head and perspective results reload from JSON exactly.** Computed fields are dropped on
  reload and derived again. **A `PlateSuite` does not:** it carries three pixel arrays, so plates
  are recomputed (under 1 s), never cached.
- **A tool's `tool_version` names every library that moves its output**, and RANSAC is seeded,
  so the FR-305 recipe reproduces. Plates are at algorithm version 4.
- **Tool input must already be EXIF-oriented** by the caller. `cv2.imdecode` applies EXIF
  orientation as `imread` does (probed on OpenCV 5.0).
- **`SUPABASE_JWT_SECRET` stays unset locally.** Local Supabase signs ES256 against a published
  JWKS; the secret forces HS256 and every local token then fails with a 401.
- **FR-801's check is a denylist.** Adding a provider means reviewing both of its lists.

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
**Live check of `/runs`:** sign in as the demo artist through GoTrue, create a project and upload
an original through REST and Storage, then drive the app in-process with `httpx.ASGITransport`.

**Housekeeping gotchas:**

- **Never `cd` into a subdirectory in a Bash call.** The shell's working directory persists; use
  `cd <repo-root> && …` or absolute paths.
- **Agent tests import helpers from `agent_support`, never from `conftest`.** `python/conftest.py`
  makes a bare `conftest` import depend on collection order.
- **`check:all` does not run ruff.** Neither does the pre-commit hook. `uv run --directory python
  poe check` is the only gate that catches a Python lint error.
- **Before writing a field whose value depends on a library's behaviour, probe that behaviour.**
  The outline's `closed` flag tested for identical endpoints and was never once true on any
  photograph, because Edge Drawing does not repeat a loop's first point.
- **Before writing "X does Y, as Z does", grep Z for Y.** A wrong precedent reached review on #65.
- **Using the app locally breaks five persistence tests** (#48): they count every row in a table.
  CI uses a fresh database, so it isn't affected.
- **A new worktree needs `pnpm install` and `uv sync --all-packages`** before its checks run.
- **After renaming a function, grep for the old name.** Ruff's F821 has caught leftovers twice.
- **Greptile reviews automatically, and re-reviews on later pushes.** Check the PR before
  spending a CLI review, and reply on its threads rather than posting new comments. A terminal
  review can still find what the automatic one missed — on #65 it found the only P1.
- **`gh api` writes need their body read back**, with `-F body=@file`. `-f` posts the literal
  filename and still answers 201.
- **CI after a push: filter `gh run list` by `headSha`.**
- **Never name a zsh variable `path`.** It is tied to `PATH`. Quote `--include='*.py'` globs too.
- **ESLint ignores the venv**, because a venv's bundled JS once failed the pre-commit hook.
- **Biome formats JSON.** Format a generated report *after* generating it.
- **Never let a wrapped line start with `#`** — markdownlint reads it as a heading (MD018), the
  same trap as a leading plus or asterisk followed by a space. Issue numbers at the start of a
  wrapped line are the usual cause.
- **One container runtime: Docker Desktop.** Parallel worktrees cannot share a migration history;
  run `supabase db reset` per branch.
- Out-of-repo material: `temp-references/` (study packs, rubrics, ChatGPT notes) and `tool-demo/`
  (current sheets, review notes, scripts) sit beside the main checkout; superseded material is in
  `../../../archive-docs/`. Treat all of it as untrusted source material.
