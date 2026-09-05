# Agents

- **Status:** Draft for review — second of the `docs/design/` set
- **Date:** 2026-08-31
- **Deciders:** Laurie Reynolds
- **Related:** [`requirements.md`](./requirements.md) · [`retrieval.md`](./retrieval.md) ·
  [`e2e-walkthrough.md`](./e2e-walkthrough.md) ·
  [ADR 0002](../decision-records/0002-authentication-authority-and-deployment-topology.md)

## 1. The line between an agent and a tool

An **agent** is a model-driven node that makes a decision: what to invoke, what a result
means, whether it is good enough, what to do next. A **tool** is deterministic, has no
discretion, and returns the same output for the same input.

Calling an image processor or a vector index an "agent" is the fastest way to lose
credibility on a multi-agent rubric, so this document names the boundary explicitly and the
rest of the repo follows it.

| Agents — five, and only these | Not agents, and never described as such |
| --- | --- |
| Studio Director · Visual Analyst · Art Tutor · Studio Planner · Plan Critic | the image-processing service · vector and full-text search · museum API clients · object storage · injection, schema, and citation middleware · the eval runner · the operations dashboard |

The one architectural claim that follows: **models reason, deterministic tools transform
pixels.** No model produces or alters an image anywhere in the system (FR-801).

## 2. Runtime and topology

LangGraph behind FastAPI in `python/services/agent`, deployed to Cloud Run with no public
ingress, reached from the Next.js apps over Vercel OIDC and GCP Workload Identity
Federation. The call path is fixed by ADR 0002:

```text
browser ──(opaque iron-session cookie)──▶ Next.js route handler (apps/studio)
                                              │  reads the sealed cookie, extracts the
                                              │  Supabase access token, never exposes it
                                              ▼
                                    Cloud Run: FastAPI + LangGraph
                                              │  verifies the forwarded token via JWKS,
                                              │  holds no auth secret of its own
                                              ▼
                                    Postgres — RLS resolves auth.uid()
```

Three properties this preserves, all already implemented in `packages/auth` and
`python/libs/auth`:

- The browser never holds a token. It holds an opaque cookie.
- Python never handles a credential and cannot mint a token. It verifies and forwards.
- RLS enforces ownership at the database, independently of application code.

The service-role key stays off the request-serving path. It is reserved for checkpoint
writes and eval jobs.

## 3. Shared state and the typed contracts

The graph carries one state object. Every field is a validated contract mirrored between
`packages/schemas` (TypeScript) and `python/libs/schemas` (Pydantic); drift fails CI
(NFR-08). Sketch, not final field lists — the schema pass is a separate document.

```text
RunState
  run_id            stable across studio, agent, and operations (NFR-09)
  project_id        owner resolved by RLS, never asserted by application code
  intent            ProjectIntent
  findings          VisualFindings
  lessons           CitedLesson[]
  plan              ProjectPlan | null
  verdict           CriticVerdict | null
  corrections       ArtistCorrection[]     artist-authored geometry facts
  transcript        ChatTurn[]             bounded window (FR-1016)
  amendments        PlanAmendment[]        proposed, accepted, or dismissed
  plan_versions     ProjectPlan[]          each tagged with the turn that produced it
  budget            BudgetLedger           tokens, image calls, cache hits, hard stop
  revision_count    int, hard-capped at 1  (FR-704)
```

### 3.1 Evidence is a type, not a convention

```text
Claim
  text            str
  evidence        Measured | Cited | Chosen

Measured   tool, tool_version, parameters, source_checksum, units ∈ {px, normalized}
Cited      chunk_id, institution, url, licence, retrieved_at, passage_span
Chosen     reason, rejected_alternative
```

`Claim` is the atom every agent emits. There is no untagged string in a plan — the union is
closed, so an unclassified claim is a schema failure before it is ever a critic finding
(FR-603, FR-702 `unclassified_claim`).

`Measured.units` excluding real-world units is what makes FR-306 structural rather than a
prompt instruction. There is no field to put centimetres in.

### 3.2 Chat contracts

```text
ChatTurn
  turn_id, role ∈ {artist, system}
  text            str
  region          Region | null          see below (FR-1005)
  claims          Claim[]                the same closed union; no relaxed chat mode
  amendment_id    str | null

Region
  outline         normalised polygon or box
  status          ∈ {proposed, confirmed, adjusted, dismissed}
  confidence      float — the agent's belief it located what the artist meant
  origin          ∈ {agent, artist}      the artist may always draw their own

PlanAmendment
  proposes        stage deltas — added, retimed, removed
  rationale       Claim[]                the evidence that motivated it
  status          ∈ {proposed, accepted, dismissed}
  resulting_plan  ProjectPlan | null     set only on accept, after the Critic re-runs
```

An artist message is trusted as **intent** and never as **evidence** (FR-1013). There is no
path by which `ChatTurn.text` from the artist becomes a `Cited` or `Measured` claim; the most
it can become is the `reason` on a `Chosen` one.

## 4. The five agents

### 4.1 Studio Director — orchestrator

| | |
| --- | --- |
| **Owns** | project state, intake questions, routing, tool selection, replanning |
| **Consumes** | raw intake, upload metadata, first-pass analysis summaries |
| **Emits** | `ProjectIntent` + a routing decision + a tool manifest |
| **May call** | no image tools directly; it *selects* them and hands the manifest to the Analyst |
| **Requirements** | FR-102, FR-103, FR-104, FR-307 |

Decision authority: which tools run, whether a clarifying question is worth its cost, and
whether a result warrants re-routing. It asks **at most one** question, and asking none is
the normal case.

Its refusals are load-bearing and must be visible: a portrait run declines perspective and
says why, which is what distinguishes a routing decision from a fixed pipeline (FR-307).

It also routes **chat turns** (§5.2), which is the same decision under a different trigger:
what does this question need, and is any of it worth its cost.

Never: interprets pixels itself, writes plan prose, or overrides the Critic.

### 4.2 Visual Analyst — specialist

| | |
| --- | --- |
| **Owns** | invoking deterministic vision tools, interpreting results, stating confidence and limitations |
| **Consumes** | the tool manifest, the immutable original, prior artifacts |
| **Emits** | `VisualFindings` + artifact references + measurements, every claim `Measured` |
| **May call** | the full Tier A/B/C tool catalog (§6) |
| **Requirements** | FR-201, FR-202, FR-300, FR-400 |

Decision authority: whether a tool result is usable, whether a second pass at different
parameters is warranted, and whether confidence is below the interrupt threshold.

It is the only agent that may emit `Measured` claims, and it may emit no other class. Every
one is bound to tool metadata — tool name, version, parameters, source checksum (FR-305).
Describing an artifact from memory is the failure mode this constraint exists to prevent.

Abstention rule: below threshold with no correction available, it emits the *limitation*
rather than the measurement (FR-406). "The jaw landmark is low confidence and was not used"
is a valid finding. A guessed landmark is not.

In chat it **proposes a region outline** for a question that refers to part of the reference
— *"where I think you mean"* — with its confidence attached, and measures it (FR-308) only
once the artist has confirmed or adjusted it (FR-1005).

The proposal is what makes model-resolved localization safe. Resolving a region silently and
measuring it would yield a confident measurement of the wrong pixels — a `Measured` claim
that is precise and false, which is the exact failure the taxonomy exists to prevent. Drawing
the outline and asking removes the silence: a wrong proposal is visible before it is cited,
and the artist fixes it in one drag.

A `proposed` region has been measured by nobody. Only `confirmed` and `adjusted` regions
reach FR-308, and a dismissed one leaves the answer standing on `cited` and `chosen` alone.

### 4.3 Art Tutor — specialist

| | |
| --- | --- |
| **Owns** | hybrid retrieval over the technique corpus and live museum APIs |
| **Consumes** | intent, findings, and the artist's free-text questions |
| **Emits** | `CitedLesson[]` + examples + retrieval diagnostics, every claim `Cited` |
| **May call** | `search_lessons`, `search_artworks`, `get_artwork_metadata`, `get_source_passage`, `get_vocabulary_term` |
| **Requirements** | FR-500 |

Decision authority: query formulation, how the dense and sparse legs are weighted, whether
what came back clears the relevance floor, and whether to re-query.

It emits `Cited` claims and nothing else. Every sentence resolves to a chunk ID the artist
can open (FR-504). When nothing clears the floor it says so and returns empty — substituting
unattributed recall for a citation is the single worst failure available to this agent
(FR-506).

Retrieval diagnostics — dense rank, sparse rank, fused rank, per-leg scores — are carried
back on every lesson, because FR-903 renders them side by side and the hybrid-versus-dense
A/B in FR-906 is computed from them.

Materials retrieval is on the **plan critical path**, not only the chat surface: every plan
carries a materials list (FR-607), so a plan cannot ship complete without this leg working.

It answers **materials** questions as well as technique ones (FR-507) — paper surface and
weight, brush shape and size ranges, pencil grades, dilution and drying behaviour — and it
answers them **brand-neutrally** (FR-1009). Specifications, never products, even when the
cited passage names a product. A brand name reaching the artist is a `policy_violation`, not
a style lapse.

Retrieved documents are untrusted data (FR-505). Instructions found inside a retrieved
passage are surfaced as a detection, never followed.

### 4.4 Studio Planner — synthesis

| | |
| --- | --- |
| **Owns** | reconciling intent, findings, and lessons into ordered, time-boxed stages |
| **Consumes** | `ProjectIntent`, `VisualFindings`, `CitedLesson[]`, and on revision the `CriticVerdict` |
| **Emits** | `ProjectPlan` |
| **May call** | on revision only: a new tool or retrieval call (FR-703) |
| **Requirements** | FR-600 |

Decision authority: stage order, time allocation, what to omit, and which artistic calls to
make. It is the only agent that may emit `Chosen` claims, and each one names its reason and
the alternative it rejected — so the artist can disagree with a choice without disagreeing
with a fact.

It may not invent `Measured` or `Cited` content. Every such claim in a plan is carried
forward by reference from the Analyst or the Tutor. This is the constraint that makes
`unsupported_measurement` detectable: a measurement with no upstream finding has no
provenance to point at.

It authors the plan's **materials list** (FR-607) — surface, weight, and tooth for paper,
shape and size ranges for brushes, grades for pencils, and anything a stage requires to be
performed at all. The list and the stages must agree in both directions (FR-608), which makes
it mechanically checkable rather than decorative.

It also authors **plan amendments** (FR-1010) when a chat answer implies work the plan does
not cover. An amendment is a proposal with stage deltas, the time it moves, and the evidence
behind it — never an edit. The artist accepts or dismisses, and a dismissal leaves the plan
byte-identical.

The self-check card (FR-605) is generated here. It is a rubric the artist applies by hand and
the system never evaluates.

### 4.5 Plan Critic — evaluator

| | |
| --- | --- |
| **Owns** | grounding, feasibility, medium fit, and policy — over the **plan**, never the artwork |
| **Consumes** | `ProjectPlan` plus the full evidence graph behind it |
| **Emits** | `CriticVerdict`: `READY` / `READY_WITH_CAUTION` / `REVISE` + typed defects |
| **May call** | nothing. It reads state and judges it |
| **Requirements** | FR-700 |

**Naming discipline: it is the Plan Critic everywhere, never "the critic."** Artwork critique
was cut from scope; a reader who sees "critic" unqualified concludes the quality gate was cut
too, which is the opposite of what happened.

Defect categories, closed set (FR-702):

| Category | Fires when |
| --- | --- |
| `unsupported_measurement` | a `Measured` claim has no upstream finding, or carries a real-world unit |
| `missing_evidence` | a stage rests on a claim with no evidence at all |
| `irrelevant_medium_advice` | advice contradicts the stated medium — colour mixing in a graphite plan |
| `infeasible_timebox` | stages sum outside ±10% of the stated budget, or a stage is implausible for the skill level |
| `unclassified_claim` | prose that carries no evidence class |
| `materials_mismatch` | a stage needs an item the materials list omits, or the list carries an item no stage uses (FR-608) |
| `policy_violation` | an identity or sensitive-trait inference, a generation request, or a followed injection |

`unsupported_measurement` and `missing_evidence` route back to the Planner **with permission
to gather new evidence** (FR-703). The others route back for revision only. This is the
distinction between a verification loop and expensive theatre.

Bound: one automatic revision, then terminate (FR-704). A second `REVISE` ships as
`READY_WITH_CAUTION` with the open defects shown to the artist rather than hidden.

An **accepted plan amendment re-runs the Critic** over the amended plan (FR-1011), which is
what keeps the chat surface inside the quality gate rather than beside it. `infeasible_timebox`
is the category that fires most often there, because an amendment spends time the budget has
already allocated — the amendment preview must therefore show what it takes time *from*.

## 5. The graph

```text
                    ┌──────────────────┐
      intake ──────▶│ Studio Director  │◀──────────────┐
                    └────────┬─────────┘               │
                             │ tool manifest           │ re-route
                 ┌───────────┴───────────┐             │
                 ▼                       ▼             │
        ┌─────────────────┐     ┌─────────────────┐    │
        │ Visual Analyst  │     │   Art Tutor     │    │  (parallel)
        └────────┬────────┘     └────────┬────────┘    │
                 │                       │             │
      confidence │ low                   │             │
                 ▼                       │             │
        ┌─────────────────┐              │             │
        │  interrupt()    │              │             │
        │  artist corrects│──resume──────┤             │
        └─────────────────┘  recompute   │             │
                 │                       │             │
                 └───────────┬───────────┘             │
                             ▼                         │
                    ┌─────────────────┐                │
                    │ Studio Planner  │◀───────────────┼── revise (≤1)
                    └────────┬────────┘                │
                             ▼                         │
                    ┌─────────────────┐                │
                    │  Plan Critic    │────────────────┘
                    └────────┬────────┘  REVISE + evidence defect
                             │ READY / READY_WITH_CAUTION
                             ▼
                        study pack
```

### 5.1 The three branch points

A graph that runs `Director → Analyst ∥ Tutor → Planner → Critic` identically every time is
a workflow with agent vocabulary, and a grader will say so. The graph branches on **tool
results**, not only on intake answers, in exactly three places.

**1. Complexity-triggered tooling.** The density-adaptive grid is not in the initial
manifest. The Director requests it only after the complexity score from the first analysis
pass crosses a threshold. Observation changes the action, within a single run.

**2. Confidence-triggered human interrupt.** Landmark or perspective confidence below
threshold raises a LangGraph `interrupt`, persists state, and waits. The artist drags the
guide; the run resumes and **recomputes downstream studies** (FR-404). Both Tier B tools can
raise it independently, so a run can interrupt twice (FR-405). This is a correction that
changes subsequent reasoning, not an "Approve?" dialog.

**One pattern, three surfaces.** Head-construction landmarks (FR-402), perspective candidates
(FR-405), and chat region outlines (FR-1005) all run *propose with confidence → artist
confirms or adjusts → recompute what depended on it*. That is deliberate: one mechanism to
build, one to test, one to explain, and one interaction the artist learns once. Three bespoke
correction affordances would be the same feature three times, worse.

**3. Defect-driven re-retrieval.** `REVISE` with `unsupported_measurement` or
`missing_evidence` lets the Planner issue a *new* tool or retrieval call rather than reword.

### 5.2 Chat is a second entry point, not a sixth agent

Studio chat (FR-1000) enters the same graph at the Director. There is no chat agent, no chat
model, and no parallel prose path — which matters, because bolting a conversational agent
onto a five-agent system is how an agent count inflates without the architecture gaining
anything.

The Director classifies each turn and routes it to the smallest sufficient subgraph:

```text
                       ┌──────────────────┐
   chat turn ─────────▶│ Studio Director  │
   (region optional)   └────────┬─────────┘
                                │ classify
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   materials or           region-grounded          implies plan work
   technique only         question                       │
        │                       │                        │
        ▼                 ┌─────┴─────┐                  ▼
   ┌─────────┐            ▼           ▼         ┌─────────────────┐
   │  Tutor  │      ┌──────────┐ ┌─────────┐    │ Studio Planner  │
   └────┬────┘      │ Analyst  │ │  Tutor  │    │ drafts amendment│
        │           │ FR-308   │ └────┬────┘    └────────┬────────┘
        │           └────┬─────┘      │                  │ artist accepts
        │                └──────┬─────┘                  ▼
        │                       │              ┌─────────────────┐
        │                       │              │  Plan Critic    │
        │                       │              └────────┬────────┘
        └───────────────────────┴───────────────────────┘
                                ▼
                        answer + evidence classes
```

Three routes, and the cost difference between them is the point:

| Turn | Example | Route | Costs | Credits |
| --- | --- | --- | --- | --- |
| Materials or technique | *"cold-press or hot-press for a loose watercolour?"* | Tutor only | one retrieval | 1 |
| Region-grounded | *"what techniques for the stubble?"* | Tutor answers; Analyst proposes an outline, measures on confirm | one retrieval, plus one measurement only if confirmed | 1, +1 on confirm |
| Implies plan work | the same question when no stage covers stubble | + Planner, then Critic on accept | a Planner pass, plus a Critic pass only if accepted | 3 |

A dismissed region proposal costs nothing — the artist is charged for the measurement, not
for being offered one.

Credits are the per-artist daily meter in NFR-11 and are **separate from the plan budget**.
Accepting an already-proposed amendment costs nothing further (FR-1018) — the spend happened
when it was drafted, and an artist is never left holding a proposal they cannot act on.

**Standalone mode** (FR-1001) is the top route with no project in state: the Director has no
findings, no artifacts, and no plan to reach for, so the subgraph reduces to the Tutor. It is
the same graph with an emptier state object, not a second system.

### 5.3 Checkpointing and resume

State is checkpointed at every node boundary and before every interrupt, keyed by `run_id`.
Checkpoint writes are the one place the service-role key is used, because a checkpoint must
survive a session that has expired underneath it. An interrupted run is resumable for the
project's retention window and appears in operations as an open interrupt, not a failure.

## 6. The tool catalog

Every tool returns an artifact **plus** metadata: name, version, validated parameters,
source checksum, duration, confidence, and stated limitations (FR-305).

| Tier | Tool | Confidence | Interrupt | Status |
| --- | --- | --- | --- | --- |
| A | grayscale | n/a | no | must ship |
| A | three-value / five-value map | n/a | no | must ship |
| A | squint / blur | n/a | no | must ship |
| A | palette + click-sample | n/a | no | must ship |
| A | structural outline, 3 detail presets | n/a | no | must ship |
| A | regular transfer grid | n/a | no | must ship |
| A | crop candidates at support ratio | n/a | no | must ship |
| A | **region measurement** (FR-308) | n/a | no | must ship — chat |
| B | **head-construction overlay** | per landmark | yes | showcase |
| B | **perspective: horizon + vanishing points** | per candidate | yes | showcase |
| B | density-adaptive grid | n/a | no | complexity-triggered |
| C | segmentation and masking | per mask | no | first to cut |
| — | **generation, inpainting, style transfer, "enhance"** | — | — | **never; asserted in CI** |

Tier A runs synchronously under 2s (NFR-01). Tier B and C run on a queued Cloud Run worker
with job status and timeout, never inside a Vercel request (NFR-02).

Head construction uses a landmark detector for detection only; **the construction geometry
is ours**, drawn as SVG from the landmarks, and is artist-correctable. Perspective produces
*candidates* with confidence, not an answer.

### 6.1 MCP

**One Art Knowledge MCP server** — `search_lessons`, `search_materials`, `search_artworks`,
`get_artwork_metadata`, `get_source_passage`, `get_vocabulary_term` — with timeouts, retries,
and a defined degraded mode (NFR-05). `search_materials` is the FR-507 leg and is the one
tool whose results pass an extra brand-neutrality filter on the way out. A **second Vision Tools MCP** wrapping the
deterministic image operations is worth doing if the schedule allows: it makes the
tools-versus-agents boundary literal in the wire protocol rather than only in prose.

Networked A2A is not proposed. Typed LangGraph handoffs are the honest answer for five
co-located agents, and adding a protocol to check a box is the agent theatre the rubrics
punish.

## 7. Middleware every hop passes through

Not agents. Deterministic, always-on, and individually testable.

| Layer | Does | Requirement |
| --- | --- | --- |
| Schema validation | every agent output validated against its contract before it enters state | NFR-08 |
| Injection screening | EXIF, filename, OCR text, retrieved documents screened; detections recorded by surface | FR-106, FR-505, FR-803 |
| Citation enforcement | every `Cited` claim resolved to a live chunk before the plan is returned | FR-504 |
| Policy | identity and sensitive-trait inference refused; image-generation boundary asserted; brand, product, and price names stripped from materials answers | FR-801, FR-802, FR-1009 |
| Budget ledger | **two independent meters**: per-project plan budget (tokens, image calls) and per-artist chat credits. Neither can stop the other | NFR-04, NFR-11 |
| Trace emission | one `run_id` across studio, agent, and operations | NFR-09 |

## 8. Termination

A run ends in exactly one of these states, and each is rendered distinctly in operations:

- `READY` — critic passed, plan delivered.
- `READY_WITH_CAUTION` — delivered with open defects shown to the artist (FR-704).
- `ABSTAINED` — confidence below threshold with no correction available; the plan omits the
  claim and says why (FR-406, FR-506).
- `REFUSED` — a policy category fired (FR-801, FR-802).
- `BUDGET_STOPPED` — the **plan budget** ceiling was reached (NFR-04).
- `INTERRUPTED` — waiting on the artist; resumable, not a failure.
- `FAILED` — an unhandled error, with the failing node named.

**Exhausted chat credits produce no run state at all.** They disable one surface and nothing
else: a plan can still be created, analysed, corrected, critiqued, revised, and exported at
zero credits (FR-1017). If chat exhaustion can ever terminate or degrade a run, that is a
bug in the ledger separation, not a budget working as designed.

## 9. Open questions

- **Model assignment per agent.** Not decided. The Critic and the Director have different
  cost and latency profiles from the Planner, and the budget ledger only becomes meaningful
  once per-agent model choice is settled.
- **Parallelism of Analyst and Tutor.** They are drawn parallel, but the Tutor's queries are
  better formed once findings exist. Fan-out versus a short sequential dependency is a real
  latency-against-quality trade and is unresolved.
- **Interrupt timeout.** How long an `INTERRUPTED` run stays resumable before it is closed
  is unset, and it interacts with the retention policy in FR-806.
- **Route classification is now also a billing decision.** Because credits are weighted by
  route (NFR-11), the Director's classification decides what a turn costs the artist. An
  over-eager amendment route charges 3 credits for a question that wanted 1, which is a
  fairness problem on top of the accuracy one.
- **Chat turn classification.** §5.2's three routes are decided by the Director, and
  mis-routing is cheap in one direction and expensive in the other: treating a plan-affecting
  question as materials-only merely under-serves, while the reverse spends a critic pass on
  nothing. The threshold is unset and wants an eval case of its own.
- **Where the transcript lives in state.** `ChatTurn[]` sits in `RunState` above, but chat
  outlives any single plan run. Whether the transcript is run state or project state changes
  checkpointing, and is unresolved.
