# Requirements

- **Status:** Draft for review — first of the `docs/design/` set
- **Date:** 2026-08-31
- **Deciders:** Laurie Reynolds
- **Supersedes:** the scope half of `docs/temp-references/art-loupe-proposal.md`
- **Related:** [`agents.md`](./agents.md) · [`retrieval.md`](./retrieval.md) ·
  [`e2e-walkthrough.md`](./e2e-walkthrough.md) ·
  [ADR 0002](../decision-records/0002-authentication-authority-and-deployment-topology.md)

Requirement IDs in this document are stable and are cited by the other design docs, by the
test-traceability flows, and by the operations dashboard panels. Add, never renumber.

## 1. Purpose

Art Loupe turns a reference photograph into a medium-aware, time-boxed working plan for a
human artist. Every recommendation traces to exactly one of three evidence classes — a
**measured** pixel fact, a **cited** instructional source, or an explicitly labelled
artistic **choice**. The system never generates or alters imagery.

The evidence taxonomy is not presentation polish. It is the anti-confabulation guardrail,
the shape of the typed contracts, the axis the operations dashboard reports on, and the
primary evaluation dimension. A sentence in a plan that cannot name its class is a defect.

## 2. Settled scope decisions

These were open in the proposal and are now closed. They are recorded here and belong in
ADR 0003 as the durable form.

| Decision | Resolution | Consequence |
| --- | --- | --- |
| Showcase vision tool | **Both** head construction and perspective (proposal option B) | Two visibly distinct routing branches; two independent low-confidence interrupt surfaces; the highest-uncertainty component sits on the critical path, so §9 fixes a cut order |
| Week 9 fine-tuning | **Omitted**, with a documented rationale | No fine-tuned artifact ships. Hybrid retrieval carries the retrieval story alone; `learning_mapping.md` must name the gap rather than imply coverage |
| Voice | **Deferred** | Multimodality is earned on images. Cascaded STT → Tutor → TTS is not in scope and is not sequenced |
| Agent runtime | **LangGraph behind FastAPI in `python/services/agent`** | Matches the course stack, ADR 0002's Cloud Run topology, and the surface already named in `flows.json` |
| Browser-to-agent path | **Browser → Next.js route handler → Cloud Run**, never browser → Python | Preserves ADR 0002: the browser holds an opaque cookie, never a token |
| Reference material | Moving to `../../reference-docs/` outside the repo | Resolves the local `lint:md` break without a markdownlint ignore entry |
| Demo imagery | **Curated, checked-in allowlist** with per-image attribution records | Makes hermetic e2e possible; attribution rows follow the `docs/media-assets.md` pattern |
| Studio chat | **In scope** — the artist asks about the reference and about their medium, in conversation | A second entry point into the same graph (§4.6). Not a sixth agent |
| Chat effect on the plan | **Propose, artist accepts** | An answer that implies plan work offers an explicit amendment; accepting re-runs the Plan Critic, so the quality gate still covers it |
| Chat without a project | **Both modes** — standalone materials Q&A and project-scoped chat | Materials questions need no photograph; standalone chat is also the cheapest surface to demonstrate hybrid retrieval on |
| Region binding | **The agent proposes an outline, the artist confirms or adjusts** | The same propose → confirm → recompute pattern as landmark and perspective correction, on a third surface. A region only backs a `measured` claim once confirmed |
| Materials specificity | **Brand-neutral classes only** | Specifications, never products. Consistent with the settled rule that commercial pricing sites are not scraped |
| Materials in the plan | **Every plan carries a materials list** | "What paper and brushes?" is the first thing a beginner asks, so it is plan output, not a chat follow-up. Puts FR-507's corpus on the plan critical path |
| Chat metering | **Chat credits, capped and reset daily** | Two independent ledgers. Exhausted chat credits **never** block plan creation — the artist returns tomorrow, or in a real product pays |

Head construction and perspective being *both* in scope raises the schedule risk the
proposal flagged. §9 answers it with an explicit cut order rather than optimism.

## 3. Actors and surfaces

| Actor | Surface | Auth | What they do |
| --- | --- | --- | --- |
| Visitor | `apps/entry` | none | reads the three commitments, accepts the acknowledgement, launches |
| Artist | `apps/studio` | Supabase Auth, role `artist` | uploads a reference, answers intake, corrects geometry, reads and exports the plan |
| Operator | `apps/operations` | Supabase Auth, role `operator` or `superuser` | inspects traces, cost, grounding, safety assertions, eval trend |

`apps/entry` never grows a workflow. It stays the built, unauthenticated shell and the home
of the acknowledgement gate.

## 4. Functional requirements

### 4.1 Intake — FR-100

- **FR-101** The artist uploads one reference photograph. Accepted: JPEG, PNG, WebP, HEIC;
  maximum 25 MB; minimum 800 px on the long edge. Anything else is refused with a reason.
- **FR-102** The artist states medium, support size, available time, self-assessed skill
  level, and a free-text goal. Medium and time are required; the rest have defaults.
- **FR-103** The Studio Director may ask **at most one** clarifying question before
  planning, and only when the answer changes tool selection. Asking zero is the normal case.
- **FR-104** Intake resolves to a typed `ProjectIntent` persisted against the project. The
  artist can edit it and re-run; re-running reuses cached artifacts (FR-905).
- **FR-105** The original upload is immutable. Every derivative records the transform
  parameters and the source checksum that produced it.
- **FR-106** EXIF, filename, and any text visible in the image are **untrusted data**. They
  are extracted for provenance and injection screening, never interpreted as instruction.

### 4.2 Reference assessment — FR-200

- **FR-201** The plan opens with an assessment of the *photograph*: overall suitability for
  the stated medium and time budget, the primary and secondary challenge, and what will be
  hard and why.
- **FR-202** The assessment names at least one concrete difficulty that is **measured**, not
  asserted — value compression, edge density, subject scale, colour range.
- **FR-203** When the reference is a poor fit for the stated intent, the assessment says so
  plainly and proposes an adjustment. It never silently plans around the mismatch.
- **FR-204** The assessment critiques the reference. It never critiques the artist, and it
  never evaluates a work in progress — that capability is out of scope (§8).

### 4.3 Deterministic studies — FR-300

All studies are produced by deterministic image processing. A model chooses *which* to run
and interprets the result; no model produces or alters a pixel.

- **FR-301 (Tier A, must ship)** Grayscale · three-value and five-value maps · squint/blur ·
  eight-colour palette with click-sampling · structural outline at three detail presets ·
  regular transfer grid · crop candidates at the artist's support aspect ratio.
- **FR-302 (Tier B, showcase)** Head-construction overlay, from facial landmarks plus our
  own SVG geometry, artist-correctable. **And** one- and two-point perspective with horizon
  and vanishing-point candidates, artist-correctable.
- **FR-303 (Tier B)** Density-adaptive grid, subdividing cells by edge density. It indicates
  visual complexity, never artistic importance, and the caption must say so.
- **FR-304 (Tier C, stretch)** Segmentation and masking. First to cut after §9's order.
- **FR-305** Every tool returns an artifact **plus machine-readable metadata**: tool name and
  version, validated parameters, source checksum, duration, confidence, and stated
  limitations. Agents cite the metadata; they never describe an artifact from memory.
- **FR-306** Measurements are reported in pixel or normalised-image units only. Real-world
  units are never inferred from an uncalibrated photograph.
- **FR-307** Tool selection is a decision, not a fixture. A run must be able to decline a
  tool and say why — a portrait run declines perspective, and that refusal is visible.
- **FR-308 (Tier A)** **Region measurement.** Given a **confirmed** region on the reference,
  return local value range, value histogram, edge density, and texture statistics, with the
  region's normalised coordinates recorded in the metadata. It never runs on a region the
  artist has not confirmed (FR-1005).

### 4.4 Geometry confidence and correction — FR-400

- **FR-401** Head-construction landmarks and perspective candidates each carry a per-feature
  confidence.
- **FR-402** Below threshold the graph **interrupts**: state is checkpointed, the artist is
  shown the low-confidence feature, and the run waits. It does not guess and it does not
  proceed with a caveat.
- **FR-403** The artist drags the guide — a landmark, the horizon, a vanishing point — and
  resumes. The correction is persisted as an artist-authored fact.
- **FR-404** Resuming **recomputes** everything downstream of the correction. A stale study
  surviving a correction is a defect, not a cache hit.
- **FR-405** Both Tier B tools raise the interrupt independently. A single run can interrupt
  twice; the second is not suppressed because the first was answered.
- **FR-406** Below threshold and with no artist available, the run **abstains**: the plan
  omits the geometry claim and says it abstained. It never asserts a low-confidence
  landmark.

### 4.5 Retrieval and instruction — FR-500

The design is [`retrieval.md`](./retrieval.md); this section states only what is required.

- **FR-501** Retrieval is **hybrid**: dense pgvector HNSW plus a sparse BM25 leg over
  Postgres full-text, fused with reciprocal rank fusion, behind metadata pre-filters on
  medium, skill level, concept, source type, and rights.
- **FR-502** Every retrieved chunk carries institution, URL, licence, and retrieved date.
  A chunk missing any of these is not retrievable.
- **FR-503** Museum *object* metadata is queried live — The Met, Art Institute of Chicago,
  Smithsonian — and cached by identifier. Collections are not ingested.
- **FR-504** Every **cited** sentence resolves to a chunk ID and a source passage the artist
  can open. A citation that does not resolve fails the run, not merely a lint.
- **FR-505** Retrieved documents are **untrusted data**, on the same footing as FR-106.
- **FR-506** When retrieval returns nothing above the relevance floor, the Tutor says so.
  It never substitutes unattributed recall for a citation.
- **FR-508** Ingestion is idempotent by content hash; a changed document supersedes its
  chunks rather than orphaning embeddings.
- **FR-509** Every ingestion run records source and chunk counts, refusals with reasons, and
  the embedding model and dimension, rendered in `apps/operations`.
- **FR-510** A source whose licence terms have not been read and given a verdict is
  **refused** at ingest, with the refusal counted and visible. Not a warning — a gate.
- **FR-511** Ingestion runs offline. It is never a request path and never a graph node.
- **FR-512** Retrieval is evaluated against a hand-authored gold set on every corpus change:
  recall@k, nDCG@10, MRR, citation-resolution rate, unsupported-claim rate, abstention rate,
  and the dense / sparse / fused A/B.
- **FR-507** The corpus carries a **materials** source type alongside technique — paper
  surface and weight, brush shape and size ranges, graphite and pencil grades, dilution and
  drying behaviour — under the same provenance fields as FR-502 and reachable through the
  existing `source_type` pre-filter. Materials answers are cited, not recalled.

### 4.6 Studio chat — FR-1000

The artist asks questions in conversation, about the reference in front of them and about
the medium they are working in. Two modes, one graph.

Requirement IDs are stable and never renumbered, so this block sits topically next to
retrieval while carrying a higher number range than the sections that follow it.

- **FR-1001** Two modes. **Standalone** chat needs no project and no upload. **Project
  chat** runs inside a project and additionally sees the intent, the findings, the artifacts,
  and the plan.
- **FR-1002** Standalone chat is retrieval-only. It answers about medium, materials,
  technique, and vocabulary, and it has no image, no measurement, and no plan to amend.
- **FR-1003** Project chat may cite any artifact or finding already computed for that
  project, by reference. It never re-describes an artifact from memory (FR-305).
- **FR-1004** **The guidance is the answer.** A question like "how do I draw stubble?" is
  answered in full from technique and materials sources without any region, and without the
  artist having to point at anything first. Localization is an enrichment, never a gate.
- **FR-1005** **Proposed region outlines.** When a question refers to part of the reference,
  the agent may propose an outline of **where it believes the artist means**, drawn over the
  image with its confidence shown. The artist **confirms**, **adjusts** it, draws their own,
  or dismisses it. A region backs a `measured` claim only once its status is `confirmed` or
  `adjusted`; a `proposed` region has been measured by nobody and is cited by nothing.
- **FR-1006** A dismissed or ignored proposal leaves the answer standing as `cited` and
  `chosen`. Confirming appends a `measured` sentence about that region and nothing else
  changes — this is the same propose → confirm → recompute pattern as FR-402 and FR-403, on
  a third surface.
- **FR-1007** Region proposal **locates image features and never identifies a person or
  infers a trait**. Outlining where stubble sits is texture localization; FR-802 continues to
  apply in full and is not softened by the region mechanism.
- **FR-1008** Every chat turn obeys the evidence taxonomy in full (§6). There is no relaxed
  conversational mode where an unclassified claim is acceptable.
- **FR-1009** **Materials guidance is brand-neutral.** Specifications only — surface, weight,
  grade, shape, size range. No brand names, no product names, no prices, no retailer links,
  even when a cited source names one. Fabricating or repeating a purchase recommendation is a
  `policy_violation` (FR-702).
- **FR-1010** When an answer implies work the plan does not cover, the chat offers an
  explicit **plan amendment**: the stages it would change, the time it would move, and the
  evidence behind it. The artist accepts or dismisses. Nothing changes on its own.
- **FR-1011** An accepted amendment re-runs the **Plan Critic** over the amended plan and is
  subject to every defect category — most often `infeasible_timebox`, since amendments spend
  time the budget already allocated. A rejected amendment leaves the plan byte-identical.
- **FR-1012** Plan versions are retained with the chat turn that produced each one, so the
  artist can see why a stage changed and revert to any prior version.
- **FR-1013** The artist's own messages are **trusted as intent and never as evidence**. A
  claim does not become `cited` because the artist asserted it; an artist assertion the
  system relies on is recorded as `chosen` with the artist named as the reason.
- **FR-1014** Chat is subject to every refusal category without exception (FR-801, FR-802).
  It is the surface where "how old is he?" will actually be asked, and it is screened for
  content pasted in from elsewhere on the same footing as any untrusted surface (FR-803).
- **FR-1015** Chat abstains rather than guesses. Outside the corpus and outside what was
  measured, the honest answer is that it does not know (FR-506).
- **FR-1016** Chat is metered in **chat credits**, held per artist and reset on a fixed
  daily schedule. Cost is weighted by route, because the three routes cost genuinely
  different amounts:

  | Route | Spends | Why |
  | --- | --- | --- |
  | materials or technique | 1 credit | one retrieval |
  | confirming a proposed region | +1 credit | the measurement, charged on confirm — a dismissed proposal costs nothing |
  | amendment proposed | 3 credits | adds a Planner pass |

- **FR-1017** **Chat credits never block plan creation.** They are a separate ledger from the
  per-project plan budget (NFR-04), and exhausting them disables one surface. Intake,
  analysis, geometry correction, retrieval inside plan synthesis, critique, revision, and the
  study-pack export all continue to work at zero credits. A run is never terminated, failed,
  or degraded because chat credits ran out.
- **FR-1018** At zero credits the chat surface says so plainly, states when credits reset,
  and stays readable — the existing transcript, its citations, and any artifact it references
  remain open. **Accepting an amendment that was already proposed costs nothing**, because
  its cost was spent when it was drafted; the artist is never left holding a proposal they
  cannot act on.
- **FR-1019** Conversation history is bounded independently of credits. Transcripts are
  deletable, and deletion propagates with the project (FR-806).

### 4.7 Plan synthesis — FR-600

- **FR-601** The plan is a `ProjectPlan`: ordered stages, each with a time box that sums to
  within ±10% of the stated budget, a goal, and a completion signal.
- **FR-602** Every stage cites the findings and lessons it rests on.
- **FR-603** Every claim in the plan carries an evidence class — `measured`, `cited`, or
  `chosen` — and unclassified prose is a defect (FR-701).
- **FR-604** Advice must fit the stated medium. Colour-mixing guidance in a graphite plan is
  a named defect category, not a stylistic quibble.
- **FR-607** Every plan carries a **materials list**, derived from the medium, support size,
  time budget, and skill level: surface, weight, and tooth for paper; shape and size ranges
  for brushes; grades for pencils; anything a stage requires in order to be performed. It is
  brand-neutral (FR-1009), cited (FR-507), and it is the first thing the plan shows, because
  it is the thing the artist has to act on before starting.
- **FR-608** The materials list and the stages must agree. A stage that calls for lifting
  with a kneaded eraser when the list carries none, or a list carrying an item no stage uses,
  is a `materials_mismatch` defect (FR-702).
- **FR-605** The plan ships with a **self-check card**: a short progress rubric the artist
  applies to their own work by hand. It is generated and never evaluated by the system.
- **FR-606** The plan exports as a study-pack PDF bundling the artifacts, the stages, the
  self-check card, and the full citation list with the reference's attribution record.

### 4.8 Plan critique — FR-700

- **FR-701** The **Plan Critic** evaluates the plan — never the artwork — on grounding,
  feasibility, medium fit, and policy, returning `READY`, `READY_WITH_CAUTION`, or `REVISE`
  with typed defect categories.
- **FR-702** Defect categories are a closed set, minimally: `unsupported_measurement`,
  `missing_evidence`, `irrelevant_medium_advice`, `infeasible_timebox`,
  `unclassified_claim`, `materials_mismatch`, `policy_violation`.
- **FR-703** On `REVISE` with `unsupported_measurement` or `missing_evidence`, the Planner
  may issue a **new** tool or retrieval call. A critic that only triggers rewording is not a
  verification loop.
- **FR-704** **One** automatic revision, then terminate. A second `REVISE` ships as
  `READY_WITH_CAUTION` with the open defects shown to the artist.
- **FR-705** The verdict, its defects, and what the revision changed are visible in both
  `apps/studio` and `apps/operations`.

### 4.9 Safety and refusal — FR-800

- **FR-801 (P0)** **Zero image generation.** No provider image endpoint is reachable from
  any graph node. Asserted in CI as a build-time reachability check, not only a runtime test.
- **FR-802 (P0)** No identity recognition and no inference of sensitive traits — age, race,
  gender, health, emotion — from a face. An explicit, tested refusal category.
- **FR-803 (P0)** Injection screening on every untrusted surface: EXIF, filename,
  OCR-visible text, retrieved documents. Detections are recorded by surface and shown in
  operations.
- **FR-804** Abstention over assertion, everywhere confidence is defined (FR-406, FR-506).
- **FR-805** Object URLs are signed and short-lived. RLS enforces ownership at the database,
  independently of application code.
- **FR-806** Deletion propagates from the original to every derivative and to every cached
  artifact keyed by its checksum.
- **FR-807** The acknowledgement gate states the three commitments before any upload is
  possible: we never generate art, your uploads stay yours, here is the retention policy.

### 4.10 Operations — FR-900

- **FR-901 Run health** — graph trajectory, node timings, retries, failure node, interrupt
  and resume points.
- **FR-902 Tool trace** — tool name and version, validated parameters, duration, **artifact
  thumbnails**, source checksum.
- **FR-903 Grounding** — queries with dense, sparse, and RRF ranks side by side, chunk IDs,
  citation pass or fail, unsupported-claim count.
- **FR-904 Safety** — injection detections by surface, refused tool calls, and the
  image-generation boundary assertion, which must read zero.
- **FR-905 Cost** — per-node tokens, image calls, cache hits, project budget versus actual.
  Artifacts cache by `checksum + parameters`; plans cache by project-state version.
- **FR-906 Evaluation** — golden-set scores by rubric dimension, retrieval recall@k, hybrid
  versus dense A/B, trend over time.

## 5. Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-01 | Tier A study: under 2s each, synchronous inside the request |
| NFR-02 | Tier B and C tools: queued Cloud Run worker with job status, timeout, and cached artifacts — never inside a Vercel request |
| NFR-03 | Full plan graph: p95 45–60s cold, faster on cached artifacts |
| NFR-04 | Per-project **plan budget**: token and image-call ceiling with a hard stop, visible in operations. Covers plan generation only |
| NFR-11 | Per-artist **chat credits**: a daily cap on conversational turns, weighted by route, reset on a fixed schedule, independent of NFR-04 in both directions. Operations reports consumption by route and how often the cap is reached |
| NFR-05 | Degraded mode is defined per external dependency: museum API down, retrieval empty, landmark detector unavailable. Each degrades to abstention plus a stated limitation, never to a guess |
| NFR-06 | WCAG 2.2 AA across all three surfaces, enforced by `eslint-plugin-jsx-a11y` and axe assertions. Every artifact image carries a text alternative describing what was measured |
| NFR-07 | en/es parity enforced by `pnpm i18n:check`. No user-facing copy is hard-coded |
| NFR-08 | Every agent output is a validated typed contract. `packages/schemas` and `python/libs/schemas` mirror; drift fails CI |
| NFR-09 | Every run is traceable end to end by a single run ID across studio, agent, and operations |
| NFR-10 | Retention is stated and enforced: originals and derivatives are deletable by the artist, and deletion is complete (FR-806) |

## 6. The evidence taxonomy, normatively

Every assertion an agent emits is tagged with exactly one class.

| Class | Means | Must carry | Example |
| --- | --- | --- | --- |
| `measured` | a fact computed by a deterministic tool | tool name and version, parameters, source checksum, units | "the darkest 12% of pixels sit in the lower-left quadrant" |
| `cited` | a claim taken from a retrieved instructional source | chunk ID, institution, URL, licence, retrieved date | "grisaille establishes value before hue" |
| `chosen` | an artistic call the system is making on the artist's behalf | a stated reason, and the alternative it rejected | "crop to 4:5 to strengthen the diagonal" |

Rules that follow, and that the Plan Critic enforces:

- A `measured` claim may never carry a real-world unit (FR-306).
- A `cited` claim may never paraphrase past what the passage supports.
- A `chosen` claim is always overridable by the artist and must be labelled as a choice, so
  the artist can disagree with it without disagreeing with a fact.
- An **artist assertion is not evidence** (FR-1013). "Trust me, the light is coming from the
  left" may be adopted, but it is adopted as a `chosen` claim naming the artist as its
  reason — never promoted to `measured` or `cited`.

## 7. Requirement-to-flow mapping

`docs/test-traceability-reports/flows.json` still encodes the cut scope. Seven of its ten
flows have zero tests, so restructuring is cheap now and expensive later. Proposed, for
your word before it is applied — the file is a CI gate and the names are yours:

| Flow | Severity | Covers | Fate |
| --- | --- | --- | --- |
| `platform.auth` | P1 | gates, sign-in, route guard | keep |
| `platform.shell` | P2 | chrome, theming, i18n, a11y | keep |
| `platform.contracts` | P2 | TS/Python schema parity (NFR-08) | keep |
| `intake.project-intent` | P2 | FR-100 | new |
| `analysis.deterministic-studies` | P1 | FR-300 Tier A, FR-305, FR-306 | replaces `palette.extraction` |
| `analysis.geometry` | P1 | FR-302, FR-400 | new — head construction and perspective |
| `retrieval.grounding` | P0 | FR-500, FR-504, FR-506 | keep |
| `retrieval.ingestion` | P0 | FR-508, FR-509, FR-510, FR-511 | new — a mis-attributed chunk fabricates an attribution, so this is P0 by the existing definition |
| `retrieval.evaluation` | P2 | FR-512 | new — gold set and the hybrid A/B |
| `plan.synthesis` | P1 | FR-600 | replaces `canvas.session-plan` |
| `plan.critique` | P1 | FR-700 | new — the Plan Critic |
| `chat.grounded-qa` | P1 | FR-1000 | new — both chat modes, region binding, amendments |
| `materials.guidance` | P2 | FR-507, FR-607, FR-608, FR-1009 | new — brand-neutral materials, in the plan and in chat |
| `safety.no-generation` | P0 | FR-801 | rename of `critique.no-generation` |
| `safety.untrusted-input` | P0 | FR-106, FR-505, FR-803 | new |
| `safety.no-identity-inference` | P0 | FR-802, FR-1007, FR-1014 | new — chat is its primary surface |
| `ops.observability` | P2 | FR-900 | keep |

Dropped: `critique.formal-analysis`, `critique.alignment`, `palette.extraction`,
`canvas.session-plan`.

Two consequences to decide alongside the names:

- The **P0 severity definition** currently reads "fabricates an attribution or citation, or
  makes the system produce imagery it must never produce." It does not cover FR-802. It
  needs a third clause — "or infers identity or a sensitive trait from a face."
- New flows need `surfaces` at workspace-root depth, and `python/services/agent` does not
  exist yet. Tagging a test there before the directory exists fails the surface check.

## 8. Out of scope

In-progress artwork critique · artist statements or biographies · any generative imagery ·
full-featured image editing · equal support for photographers · social features, galleries,
sharing · marketplace or supplies · full museum or Getty ingestion · five MCP servers ·
three-point perspective · paint-brand spectral matching · native mobile · voice · a
fine-tuned model artifact · **brand or product recommendation, pricing, and purchase
links** (FR-1009) · open-ended conversation unrelated to making the work.

The last two are deferrals rather than rejections, and `learning_mapping.md` states them as
gaps against the curriculum rather than eliding them.

## 9. Cut order

Both Tier B tools shipping means the critical path carries the two highest-uncertainty
components. If the schedule tightens, cut in this order and stop as soon as it fits:

1. `analysis.geometry` **segmentation and masking** (Tier C) — already first to cut.
2. **Perspective** — the canal branch keeps the adaptive grid, the value maps, and the
   outline, so the second demo route survives with a weaker showcase.
3. **Density-adaptive grid** — cheap, but it is what makes the two routes look different, so
   it goes only if perspective already went.

Head construction is the last Tier B tool standing. It carries the portrait demo, the
memorable visual, and the strongest HITL moment, and cutting it removes all three at once.

## 10. Open questions

- **Supabase Auth call path.** ADR 0002 and `settled-decisions.md` commit to Supabase being
  called **server-side** from the Next.js apps, with the browser holding only an opaque
  iron-session cookie and never a token. `packages/auth` is built that way on both sides.
  Calling `supabase-js` directly from the browser would put a token in the client and
  contradict a shipped ADR, so this doc assumes the built design. If direct-from-browser
  auth is wanted, it is an ADR 0002 amendment, not a detail.
- **Long-running job transport.** NFR-02 puts Tier B and C work on a queued worker. Whether
  the studio polls job status or holds a streamed connection changes the route-handler
  design and is not yet decided.
- **Corpus size and licence mix.** "Hundreds to low thousands of chunks" needs a concrete
  first target and a per-source licence verdict table, on the `docs/media-assets.md` model.
- **Golden set ownership.** FR-906 assumes a golden set exists. Who authors it, and how many
  cases, is unanswered.
- **The credit numbers are yours.** FR-1016 fixes the mechanism and the route weighting; the
  daily allowance and the reset time are unset. A useful way to pick them: how many turns
  should a first-time artist get through on their first project without hitting the wall?
- **Reset schedule shape.** A fixed daily reset is easy to explain and easy to game at the
  boundary; a rolling 24-hour window is fairer and harder to reason about. Fixed is assumed.
- **Materials corpus sourcing, now on the critical path.** FR-607 means every plan needs
  materials sources, so this is no longer a chat-only dependency. Museum educational essays
  cover technique well and materials badly, so it needs its own open-licence sources and its
  own licence verdicts before the first plan can ship complete.
- **Conversation history window.** FR-1019 bounds history without saying how. Credits cap
  turn *count*; the window caps per-turn *context*, and they are separate levers.
