# Slice 1 — upload, routing, geometry overlays, deterministic plates

## Context

Art Loupe is at initial scaffold: three Next.js shells, a shared UI package, a uv Python
workspace whose only member is `python/libs/auth`, and no product code. There are zero route
handlers, zero `fetch()` calls in any app, no Python HTTP service, and no LangGraph, LangChain,
Anthropic, or OpenAI dependency anywhere. Four of nine design documents are written and
uncommitted.

Laurie has chosen to start building the product's spine while the remaining design documents
are resolved, in small increments and small PRs. This slice delivers the first vertical: an
artist uploads a reference photograph, an agent decides how to analyse it, interactive geometry
overlays are drawn and corrected, deterministic plates are produced, and the operations
dashboard shows what it cost.

The slice maps entirely onto requirements already written. **No requirement is amended.**

## Empirical finding that shaped this plan

The slice originally included a generatively produced "coloring book" plate, which would have
retired `FR-801 (P0)` — *"Zero image generation."* Before building it, four generated plates
were produced from two Pexels demo images (a Murano canal, a low-key studio portrait) across
ChatGPT and Gemini. The results retired the idea instead:

- **Omission.** Gemini dropped the people at the café tables, the trees above the rooflines,
  and several boats. It reconstructs from an archetype rather than reading the photograph.
- **Colour leak.** Gemini rendered shopfront doors in green against an explicit "pure black on
  white" instruction — recalling that Venetian buildings are coloured, not reading the source.
- **Invented type.** ChatGPT rendered "Osteria / Bar / Ristorante / Locanda" as clean legible
  signage rather than tracing sign shapes.
- **Likeness loss.** On the portrait, **none of the four** preserved the sitter — all made him
  younger, rounder, more symmetrical, and dropped the stubble, the mole, and the facial
  asymmetry. Fatal for a Loomis overlay, where head proportion *is* the thing being checked.
- **Value loss.** All four rendered a navy sweater on a near-black ground as white with thin
  lines, discarding the light direction and inverting the stripe values. The line plate carries
  none of what a low-key reference actually needs.
- **Aspect ratio was preserved by both vendors** (3:2 and 2:3 exactly). Framing still drifted —
  Gemini crops tighter.

A one-minute Canva desaturation beat all four on the axes that matter: nothing omitted, exact
registration, value structure intact.

**Conclusion:** the deterministic plate suite FR-301 already specifies serves the artist better
than the thing being chased. The generative backend is dropped, FR-801 stands as written, and
the *"never generates imagery"* claim stays structurally verifiable rather than becoming a
policy promise.

## Decisions locked this session

- **Deterministic plates only.** No image vendor, no second API key, no weights for plate
  generation, no terms-of-service surface, no ADR amendment.
- **Slice 1 ships three plates from one pipeline**: grayscale, three-value posterization, and
  **outline-derived-from-posterization**.
- **Full computer vision** for geometry: face landmarks and line/vanishing-point detection with
  per-feature confidence. Accuracy is **not** tuned or validated against a gold set — low
  accuracy is acceptable — but confidence values must be real, because they drive the interrupt.
- **Real interrupt and resume**, with Supabase Storage for the source image. A correction
  checkpoints the graph and recomputes everything downstream (FR-402/403/404).
- **The Studio Director selects plates and geometry tools** and may decline one with a stated
  reason (FR-307).
- **`flows.json` gets only the ids this slice needs**, not the full §7 restructure.
- **Backlog, not build:** the transfer grid, the proportion-overlay view, and the
  trace-then-paint use case an artist friend raised.

## The outline-from-posterization idea

Canny and XDoG disappoint because they trace *every* gradient, so texture, noise, and grain all
become lines — the speckle Laurie had already hit. Instead: posterize to N values first, then
trace the boundaries **between value regions**.

The result is closed, clean, meaningful contours, because it traces where the light changes
rather than where the texture does. Fully deterministic, perfectly registered, no weights, no
vendor. The detail presets fall out of the same parameter — a 3-value map gives a coarse
outline, a 7-value map a fine one — so one tool serves both the value plate and the outline
plate, and the two are guaranteed to correspond.

## Transport and deployment — settled

**Everything goes through Next; CSP is never widened.** Upload via a route handler, display via
a read-through image route, so `img-src` and `connect-src` both stay `'self'` and no
`remotePatterns` entry is needed. Consistent with ADR 0002's server-side philosophy, and it
resolves the open "Supabase call path" question in `docs/current-state.md` in the same direction
ADR 0002 and the shipped `packages/auth` already chose.

**Local only, no deployment planned.** Vercel's 4.5 MB serverless request-body cap is a platform
limit that `serverActions.bodySizeLimit` cannot raise; with no Vercel target, FR-101's 25 MB
stands as written. Recorded deferrals: the Dockerfile and Cloud Run packaging are optional until
deployment is real. If deployment happens, revisit transport **before** choosing a target.

**Still a real blocker: the `api` matcher gap.** `apps/studio/src/proxy.ts` ends with
`matcher: ['/((?!api|_next/static|_next/image|.*\\..*).*)']`. The first route handler in this
repo's history would be ungated by construction — no ack gate, no auth gate — while carrying
artist images. Matcher policy, per-handler `getSession()`, and new `route-gate-matrix.md` rows
must land before any handler carries a payload.

## Corrections to earlier assumptions

- **`surfaces` in `flows.json` IS enforced** — corrected. `scripts/reports/traceability-report.mjs`
  checks it at line 566: tagging a flow onto a directory it does not declare is a hard error.
  An earlier note here claimed otherwise; that came from a `grep` that silently returned
  nothing because `grep` is aliased to `ugrep` on this machine. `python/conftest.py` genuinely
  does not read the field — it validates only `flow` and `category` — so the enforcement is
  entirely on the Node side, which is why a Python test outside `<pkg>/tests/` escapes it.
- **Most needed flows already exist.** `platform.contracts` declares `packages/schemas` and
  `python/libs/schemas`; `critique.no-generation` and `ops.observability` declare both
  `apps/studio` and `python/services/agent`. Only `analysis.geometry` and
  `intake.project-intent` are new.
- **What *is* enforced** is the discovery walk: `apps/*/src`, `apps/*/e2e`, `packages/*/src`,
  `python/{libs,services}/*/tests`. A Python test outside `<pkg>/tests/` is validated by
  conftest but invisible to `traceability:check`. Keep Python tests in `<pkg>/tests/`.
- **`untagged-baseline.json` is `{"packages": {}}`** — zero debt allowed. Every PR ships its
  tests tagged.
- **veloce-trace has less to lift than assumed.** No interrupt, no `recursion_limit`, no
  wall-clock/token/iteration cap, no Supabase Storage, no auth on its Python service, no
  Dockerfile. Its `hardstop.py` is a clinical regex gate, not a resource cap. Reusable:
  `service.py` shape, `build_graph(checkpointer=None)`, `get_async_checkpointer()`,
  `instrument_run()`, and the ops panels.

## PR ladder

| # | PR | Why here |
| --- | --- | --- |
| 1 | Contracts — `packages/schemas` + `python/libs/schemas` with a shared JSON fixture both suites assert against; add `analysis.geometry` and `intake.project-intent`; add `@artloupe/schemas` to `transpilePackages` in all three apps; drop `--passWithNoTests` | The parity fixture is what makes hand-mirrored Zod/Pydantic safe |
| 2 | `python/services/agent` skeleton — FastAPI, `python/libs/auth`, `/health`, trivial graph, CI job (no Dockerfile — deferred with deployment) | `services/*` is already a workspace glob; purely additive |
| 3 | Checkpointer lib + a two-node toy interrupt/resume spike that survives a **process restart**; tables in a `langgraph` schema, not `public` | Highest-uncertainty mechanism in the slice with no prior art in either repo — prove it before CV depends on it |
| 4 | Loop guards + per-node token/latency/cost instrumentation | Net-new; the ledger must exist before the first paid call, or PR 14 renders an empty table |
| 5 | Storage + RLS + `projects` table + checksum + signed-URL helper (no HTTP path yet) | Database-shaped and independently reviewable |
| 6 | Route-handler gating — `api` matcher policy, per-handler `getSession()`, `route-gate-matrix.md` rows, read-through image route | The first route handler is ungated by construction |
| 7 | Upload + intake + EXIF/filename/OCR screening **at ingest** + fixture fallback when `ARTLOUPE_AGENT_URL` is unset | FR-106/803 require screening before any model sees the bytes; the fallback keeps Playwright hermetic |
| 8 | Plate suite — grayscale, three-value posterization, outline-from-posterization, all from one pipeline, emitting FR-305 metadata | No dependency fight, no vendor, and the three plates visibly relate because they share a parameter |
| 9 | Overlay primitives in `packages/fascia`, built against a fixture image — keyboard path, 24 px targets, non-drag alternative, own a11y tests | Largest net-new UI in the slice, zero existing primitives, zero dependency on CV output |
| 10 | Face landmarks + Loomis + confidence — MediaPipe Tasks, **no torch** | Isolates the one dependency-resolution risk so a red CI means only that |
| 11 | Line + VP detection + confidence — OpenCV Hough/LSD | Independent of 10 |
| 12 | Routing call — deterministic face gate feeds a structured-output manifest and declination reason; checksum-keyed node cache | Keeps the critical path deterministic where it can be |
| 13 | Interrupt + resume — **`runs` table with owner RLS**, threshold as runtime config, `interrupt()` alone in its node, force-interrupt affordance | The runs table is the missing authz boundary; node isolation stops resume double-charging |
| 14 | Ops cost + run health | Reads tables PRs 4 and 13 already fill |

## Risks worth naming

- **Interrupt re-execution.** On resume, the entire node containing `interrupt()` re-runs from
  the top. Any side effect before the call — storage write, metering increment, LLM call —
  happens twice and double-counts the ledger. Put `interrupt()` alone in a node that does
  nothing else.
- **Resume lands on a different process.** Local dev restarts constantly, so the PR 3 spike must
  survive a process restart rather than an await. This is why Postgres checkpointing is
  mandatory even without Cloud Run.
- **No torch.** MediaPipe Tasks `face_landmarker` is a ~3 MB `.task` file with no torch
  dependency. Torch adds ~2.5 GB and slows `uv sync --all-packages --frozen` on every PR.
  Everything in FR-301/302/401 is reachable with MediaPipe Tasks + OpenCV + numpy.
- **MediaPipe's pins are hostile** — protobuf/numpy/jax ranges that fight `numpy>=2`. Confirm a
  py3.12 arm64 wheel exists, and check the `.task` model's licence, before committing.
- **Cache key.** Key on the FR-105 content checksum — never the signed URL (they rotate) and
  never the bytes. Do **not** reuse veloce-trace's `SqliteLLMCache`: it keys on the serialized
  prompt, so a multimodal message writes megabytes per entry and misses on every re-upload.
- **Portrait-vs-not should not be an LLM decision.** It is `face_landmarker` returning ≥1 face —
  deterministic, free, testable. The model owns the manifest and the declination *reason* given
  the detector's output. FR-307 stays honest and a nondeterministic hop leaves the critical path.
- **The interrupt may not be demoable.** With untuned CV, whether confidence lands below
  threshold on a given demo image is luck. Ship the threshold as runtime config with a
  documented demo value plus a force-interrupt affordance.
- **HEIC.** FR-101 accepts it; Pillow needs `pillow-heif` and browsers will not render it.
  Recommend dropping it for the slice.

## Cut from slice 1

Torch and learned edge detection. HEIC. Tier C segmentation (already first-to-cut per §9). The
density-adaptive grid, crop candidates, five-value maps, squint/blur, and palette sampling — the
rest of Tier A follows in slice 2. The transfer grid, the proportion-overlay view, and the
trace-then-paint workflow go to the backlog.

## Verification

- `pnpm check:all` — format, lint, CSS, markdown, i18n parity, traceability, contrast,
  typecheck, unit tests.
- `pnpm depcruise`, `pnpm circular`, `pnpm size` — **not** in `check:all`; run by hand.
- `uv run --directory python poe check` — ruff + pytest.
- `pnpm supabase start && ./scripts/seed/seed-demo-accounts.sh && pnpm dev`, then the real flow:
  upload a demo image, watch the routing decision and its declination, compare the three plates,
  drag a low-confidence guide, confirm downstream studies recompute, confirm the cost panel moves.
- `pnpm e2e` — kill any stale Playwright server first; it reuses one off-CI and serves stale
  baked headers.
