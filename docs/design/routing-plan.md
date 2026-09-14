# Routing — plan for slice-1 PR 12

**Status:** proposed · **Date:** 2026-09-13

`slice-1-build-plan.md` remains the ladder. This document proposes *how* PR 12 is built. PR 12 is
the routing call: a deterministic face gate, a model that emits a tool manifest with its
declinations, and a checksum-keyed node cache. §1 records the calls already made. §10 keeps the
reasoning behind the last two, on refusal fallbacks and on where completeness is checked.

## 1. Decisions taken (Laurie, 2026-09-13)

- **Scope: the manifest, and the tools it selects.** PR 12 routes and then runs what it routed.
  PR 13's interrupt therefore has real confidences to read. The studio is **not** wired in this
  PR. The agent is exercised through its HTTP surface and its tests.
- **What the Director sees: intent, the gate, and deterministic summaries.** No pixels reach the
  model. This follows `agents.md` §4.1, which says the Director "never interprets pixels itself"
  and consumes "first-pass analysis summaries."
- **Model: `claude-opus-5`.** This is the first model assignment in the repo. `agents.md` §9 lists
  per-agent model assignment as open, and this settles it for the Director only.
- **Cache: a Postgres table with owner RLS.** The cache survives a restart. Reopening a study
  therefore sends MediaPipe's usage report to Google zero times, which
  `geometry-confidence-plan.md` §6 already promises.
- **The survey runs the real perspective tool**, not a cheaper line probe (§3).
- **The FR-801 check lands in PR 12** (§7).
- **PR 12 is split into 12a and 12b** (§9). Laurie left the split to judgement.
- **No ADR yet.** These decisions stay in this design note until they settle.
- **Server-side refusal fallbacks are on**, in the `"default"` mode (§10, question 1).
- **The completeness check lives at the producer**, not on the shared contract (§10,
  question 2).

## 2. The graph

```text
START → load_project → face_gate → survey → direct → analyse → END
```

| Node | Kind | What it does |
| --- | --- | --- |
| `load_project` | deterministic | Reads the `projects` row (the intent) and the `source_images` row (checksum, storage key) as the artist. Downloads the bytes and decodes them EXIF-oriented. |
| `face_gate` | deterministic | Runs `find_face`. `None` is the declination of `head_construction`. |
| `survey` | deterministic | Produces the first-pass summaries the Director reads (§3). |
| `direct` | **model** | The Studio Director. Emits the routing decision (§3). |
| `analyse` | deterministic | Runs the selected tools through the cache (§4). |

Every node is registered through `instrumented(...)`, as `graph.py` already requires. Only
`direct` spends tokens. Every other node records a real zero.

**The image never enters `RunState`.** `RunState` is checkpointed, and a 25 MB photograph in a
checkpoint would be written on every superstep. The decoded image lives in a run-scoped
`ContextVar`, the same mechanism `use_recorder` uses. The state carries only the checksum. When
PR 13 resumes a run in a different process, the context is empty and the image is fetched
again. That is the correct behaviour, because the bytes are immutable under FR-105.

**`analyse` is deterministic in this PR.** `agents.md` §4.2 defines the Visual Analyst as an agent
that interprets results and emits `VisualFindings`. PR 12 builds only its execution half. The
interpretation half arrives with the plan, and this document does not pretend otherwise.

### How a selection maps onto a tool call

- `grayscale`, `value_map`, `value_shapes` and `outline` come from one `make_plates` call. A
  declined plate is still computed, because the four share one pipeline. Its declination governs
  what the plan uses and shows, not what the pipeline spends.
- `head_construction` calls `construct_from_face` on the gate's `DetectedFace`. It does not run
  a second detection, so a run opens one landmarker and sends Google one usage report (#43, the
  MediaPipe usage-metrics issue).
- `perspective` reuses the survey's result from the cache. A declined perspective result was
  still computed, for the same reason a declined plate was.

## 3. What the Director sees and returns

### Input

- The `ProjectIntent`: medium, time budget, support, skill level and goal.
- The gate: whether a face was found. When one was found, the gate also supplies
  `facial_landmark_reliability` and the face's height in pixels.
- The survey: the perspective result's best confidence, and how many vanishing points cleared
  the 0.35 floor, plus the value-map's fitted thresholds and the photograph's value spread.
  Each figure is quoted from FR-305 metadata. FR-305 says agents cite the metadata and never
  describe an artifact from memory, and this is where that rule first binds a model.
- **The goal is untrusted text** (FR-106). It was screened at ingest. It is placed in the prompt
  as delimited data, and the system prompt says it is never an instruction.

The survey runs the real `detect_perspective` rather than a probe built on `detect_segments`.
The real tool's result is cached, and it is reused when perspective is selected. A probe would
have been a new, unnamed measurement with no FR-305 metadata for the Director to cite.

### Output

A new shared contract, `RoutingDecision`, holds three parts:

- `manifest` — the existing `ToolManifest`, unchanged.
- `rationale` — the routing summary walkthrough beat 4 renders. The walkthrough calls it
  "the tool manifest and its routing rationale."
- `gate` — the deterministic outcome: `face_found`, plus the gate's own reason when it declined.

It lands in `packages/schemas` and `python/libs/schemas` together, with fixture cases in
`contract-parity.json`, as NFR-08 requires.

### The gate decides `head_construction`, and the model decides the rest

When no face is found, `head_construction` is **pre-declined** with the gate's reason. That reason
includes the small-face limitation from #45 (faces below the bundled detector's minimum). The tool
is also removed from the choices the model is offered, so the model cannot select it. When a
face is found, `head_construction` becomes eligible, not mandatory. An artist whose goal is the
background may still have it declined.

This keeps FR-307 honest in both directions. The deterministic half cannot be overridden by a
model slip. The model's half is a real decision rather than a lookup table.

### Every tool is accounted for

The current `ToolManifest` refuses a tool that is both selected and declined. It does not refuse
a tool that is neither. An omitted tool is a silent declination, which FR-307 exists to forbid.
The Director's output is therefore validated for completeness: every tool in `TOOLS` appears
exactly once, in one list or the other. The check lives at the producer, not on the shared
contract (§10, question 2).

## 4. The cache

A new migration creates `public.tool_results`.

### What 12a caches

**The face and perspective results only.** Measured on the two demo photographs:

| Result | Canal (5040×3360) | Portrait (4016×6016) | JSON without pixels |
| --- | --- | --- | --- |
| `make_plates` | 906 ms | 713 ms | 569 KiB / 219 KiB |
| `detect_perspective` | 115 ms | 86 ms | 11 KiB / 1 KiB |
| `find_face` | 563 ms (no face) | 208 ms | — / 39 KiB |
| `construct_from_face` | — | 1 ms | 12 KiB |

- **The face is the result the cache exists for.** Recomputing it sends Google a usage report
  (#43). A `None` result is cached too, so a photograph with no face is not re-detected on every
  reopen either.
- **Perspective is cached** because the survey computes it and `analyse` reuses it.
- **Head construction is not cached.** It takes 1 ms from a cached face.
- **Plates are not cached in 12a.** A `PlateSuite` carries three pixel arrays
  (`grayscale.image`, `values.image`, `values.labels`), so it does not serialize to JSON and
  cannot reload without them. Caching plates would need a new pixel-free model in `image-tools`.
  A plate run takes under a second, within NFR-01's two-second budget, so plates recompute on
  every run. Plate delivery needs a derivatives store anyway, and it revisits this.

`docs/current-state.md` says every tool result "reloads from JSON exactly." That holds for the
face and perspective results, and not for `PlateSuite`.

### The table

| Column | Notes |
| --- | --- |
| `project_id` | References `projects` with `on delete cascade`. |
| `source_checksum` | Lowercase hex SHA-256, with the same check `source_images` carries. |
| `tool`, `tool_version` | Owned by the schemas. They are not check-constrained here, for the same reason `medium` is not. |
| `parameters_digest` | SHA-256 of the validated parameters as canonical JSON. |
| `result` | The tool's result as JSON. Every tool already reloads from JSON exactly. |

The unique key is `(project_id, tool, tool_version, parameters_digest)`.

**Keyed per project, not per owner and checksum.** An artist may upload the same photograph to two
projects. Deleting one project must remove that project's results and leave the other's intact.
Per-project keying makes the cascade exact. The cost is that the same photograph is analysed
twice across two projects, which is acceptable.

**Deletion needs no change.** ADR 0003 says derivative tables "join the cascade as they are built
and need no change to the deletion path, provided they hang off `projects`." This one does. The
deletion test still has to assert that `tool_results` rows vanish, because nobody has verified
that a cascade crosses this table's grants and RLS. That test is the verification.

**Grants follow the `source_images` pattern.** Every privilege is revoked from `anon` and
`authenticated`. `select` and `insert` are then granted back to `authenticated`. There is no
`update` grant, because a result is immutable for its key. A new tool version gets a new row. A
trigger refuses updates from callers that bypass RLS as well.

**Ownership is derived from the project**, as it is for `source_images`. The table has no owner
column, so the owner is recorded in exactly one place.

**The insert policy ties each row to its photograph.** A row is accepted only when the artist owns
the project *and* its `source_checksum` equals that project's original. Without the second
condition, a row could sit under one project while describing other bytes. Every later cache hit
would then hand the artist a measurement of the wrong photograph.

**Result sizes are small enough for one insert.** The largest cached result is the portrait's face,
at 39 KiB.

## 5. Credentials and image access

**Every read and write runs as the artist.** No app runtime holds `service_role`, so the agent
cannot use `DATABASE_URL`, which connects as `postgres` and bypasses RLS. The cache table's owner
policy would mean nothing if the agent wrote around it.

**The model never touches this path.** Data access is plain code in the deterministic nodes. No
data-access tool is offered to the model, through MCP or otherwise, so the Director can only
reason over what the nodes hand it.

- **`artloupe-auth` keeps the raw bearer token.** `VerifiedToken` currently discards it. The token
  is added in a form that is excluded from `repr` and from logging.
- **The token lives in a run-scoped `ContextVar`, next to the image.** It never enters `RunState`
  and never enters LangGraph's `config`, because both are checkpointed. A credential in a
  checkpoint would outlive the token's own expiry by as long as the checkpoint is retained.
- **A small artist-scoped Supabase client lives in `artloupe-persistence`.** `tables.py` already
  names it as "the Python that will read them." It uses `httpx` with `SUPABASE_URL`, the anon key
  as the `apikey` header, and the artist's bearer token. It mirrors
  `apps/studio/src/lib/intake/ingest-upload.ts` rather than inventing a second request shape.
- **A run refuses to start with a nearly expired token.** The run's wall-clock ceiling is 120 s.
  A token that expires inside that window would fail partway through, so `execute_run` checks
  `expires_at` against the ceiling before the first node.

## 6. The model call

- **The `anthropic` SDK becomes a dependency of `artloupe-agent` only.** It is the first provider
  SDK in the workspace, and adding it needs Laurie's approval before `uv add` runs.
- **The model id is configuration.** `ARTLOUPE_DIRECTOR_MODEL` defaults to `claude-opus-5`. It is
  configuration because an eval should be able to compare models without a code change.
- **Structured output uses `AsyncAnthropic().messages.parse`** with the `RoutingDecision` model.
  The result is validated again against the Pydantic contract after parsing. The exact SDK binding
  is checked against the SDK before the code is written.
- **Refusals are handled before content is read.** The node branches on `stop_reason`.
  Server-side fallbacks are on, as `fallbacks: "default"` with the beta header
  `server-side-fallback-2026-07-01` (§10, question 1). The substitute model can refuse too, so the
  branch stays.
- **Usage is reported through `record_usage`**, with the model id taken from the response. The
  price table now lists `claude-opus-4-8`, so a call a fallback serves is priced rather than
  recorded as unpriced.
- **CI never calls the API.** The client is injected. Unit tests use a recorded responder. One
  live smoke test sits behind an opt-in marker and needs a real key.
- **The model call spends real money.** It is billed to an Anthropic API account. That billing is
  separate from any Claude subscription plan. A routing call is small — a few thousand tokens in,
  well under a thousand out — so the rough estimate is a few cents per run at Opus 5's list price.
  The ledger measures the real figure once the node exists.
- **The key comes from a rebuilt keychain seam** (Laurie, 2026-09-13). `python/.env.example`
  describes an `artloupe.config` seam, and `python/.env.local` configures it, but no code
  implements it. 12b ports veloce-trace's `veloce-config` as `python/libs/config`:
  - In production, the key comes only from `ANTHROPIC_API_KEY`, and a missing key fails fast.
  - Locally, an explicit `ANTHROPIC_API_KEY` wins. Otherwise the key is read from the macOS
    keychain at `ARTLOUPE_KEYCHAIN_SERVICE` and `ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT`.
  - The key is passed straight to the client and never exported. An exported key would be
    visible to every child process.
  - The port loads `python/.env.local` as well as `python/.env`, because veloce read only
    `.env`. It also decides whether `ARTLOUPE_SECRET_SOURCE` survives, since veloce had no
    such variable.
  - Only key resolution is ported. Veloce's AI cache, LangSmith tracing, hard-stop mode and
    pre-LLM scrubbing are left behind. LangSmith would send run data to another third party,
    so adding it is a disclosure decision for epic #57, not a port.
- **`python/.env.example` is corrected where 12b touches it.** It also describes a retrieval
  backend and a dev AI-call cache that nothing implements. Those lines are outside this PR, and
  they are filed as an issue rather than fixed here.

## 7. The FR-801 check

FR-801 (P0) reads "Zero image generation. No provider image endpoint is reachable from any graph
node." `README.md` calls this "structurally verifiable rather than a policy promise." **No check
exists today.** No test is tagged with the `critique.no-generation` flow. `.dependency-cruiserrc.mjs`
carries six structural rules and none about providers. The only other mentions are comments.

The claim is true today, but only vacuously: the workspace has no provider SDK at all. PR 12
installs the first one. Anthropic's API has no image-generation endpoint, so the claim stays
true after PR 12. It is still unverified, and `python/.env.example` already anticipates OpenAI
for embeddings, whose API does have image endpoints.

**The check lands in 12a** (Laurie, 2026-09-13), before the SDK arrives. 12b's new dependency is
then checked by a test that is already green, rather than by a test written alongside the thing
it tests. The check makes two assertions:

- **No image-generation SDK is installed** in the agent's dependency closure.
- **No Python source references an image-generation endpoint or method.** OpenAI's images API is
  the concrete case, because OpenAI is the provider `.env.example` already expects.

Each assertion carries a negative fixture proving it fires. A check that has never caught
anything proves nothing about whether it can.

**The check is a denylist, and it says so.** It catches known vendors and known endpoints. It
cannot catch a vendor nobody has listed. Adding a provider therefore means reviewing the list,
and the test's docstring says that plainly. #63 (the FR-801/FR-807 amendment) would later narrow
the check to the deterministic plate path.

## 8. Tests and traceability

| What | Flow | Category |
| --- | --- | --- |
| Graph topology, the image and token context, the run-start expiry check | `platform.agent-runtime` | functionality, security |
| The gate, pre-declination, completeness, the Director with a recorded responder | `intake.project-intent` | functionality |
| The goal as delimited data in the prompt | `safety.untrusted-input` | safety |
| `RoutingDecision` parity | `platform.contracts` | data |
| `tool_results` RLS, grants, and the deletion cascade | `platform.agent-runtime` | security, privacy |
| Tool execution through the cache | `analysis.geometry`, `analysis.deterministic-studies` | functionality |
| The FR-801 check | `critique.no-generation` | safety |

Walkthrough beat 4 already names `intake.project-intent` as the flow for routing. Two surfaces
need adding to `flows.json`. `safety.untrusted-input` does not declare `python/services/agent`,
and `analysis.deterministic-studies` declares only `python/libs/image-tools`. Adding a surface is
correct in both cases, because both flows now genuinely run in the agent.

## 9. How PR 12 splits

PR 12 spans an auth change, a Python Supabase client, a migration, a contract, four new nodes,
the first provider SDK and the first model call. That is too much for one review, so it lands as
two PRs.

**12a — the deterministic path, with no vendor.**

- `artloupe-auth` keeps the raw token, and the artist-scoped client lands in
  `artloupe-persistence`.
- The `tool_results` migration, its RLS tests, and the deletion-cascade test.
- The `load_project`, `face_gate`, `survey` and `analyse` nodes.
- `direct` as a **deterministic stand-in**. It declines `head_construction` when the gate found no
  face and selects every other tool. Its code and its tests say plainly that it is a placeholder
  and that FR-307 is not met until 12b replaces it.
- The FR-801 check, and the `claude-opus-4-8` price row.
- The two `flows.json` surface additions.

**12b — the Director.**

- The `anthropic` dependency and the `ARTLOUPE_DIRECTOR_MODEL` setting.
- The `RoutingDecision` contract, in both languages, with parity fixtures.
- The model-driven `direct` node, completeness validation, and refusal handling.
- The `.env.example` correction, and the opt-in live smoke test.

The reasoning is the same one PR 10 used for MediaPipe: isolate the one new dependency, so that
a red CI means only that. 12a is also reviewable on its own. It proves the data path, the cache
and the tool execution before any model depends on them.

## 10. The last two calls, and why

### 1. Server-side refusal fallbacks — on (Laurie, 2026-09-13)

**What they are.** Claude Opus 5 runs safety classifiers on each request. A request they decline
still returns HTTP 200, but with `stop_reason: "refusal"` and usually no content. By default that
refusal comes back to the caller, and the routing node would fail the run with a named error.

With `fallbacks: "default"` and the beta header `server-side-fallback-2026-07-01`, the API re-runs
a declined request on a substitute model inside the same call. The substitute is chosen by the
refusal's category. The caller receives the substitute's answer, and `response.model` names the
model that actually answered. A refusal before any output is not billed. The substitute's answer
is billed at the substitute's own rates.

**Tradeoffs.**

- **On:** a refused routing call still produces a routing decision. The ledger records the model
  that answered, which is why `claude-opus-4-8` now has a price row. The feature is a beta, so its
  shape may change.
- **Off:** a refusal fails the run visibly, and "which model decided this" always has one answer.
  It is also one fewer beta surface.
- **Either way, the node handles `stop_reason: "refusal"`.** The substitute can refuse too.

**How likely it is to matter.** The classifiers target areas such as cybersecurity and biology.
A routing call about an artist's reference photograph is unlikely to trip them. The Claude API
skill recommends turning fallbacks on by default for Opus 5.

### 2. The completeness check lives at the producer (Laurie, 2026-09-13)

**Who produces a manifest.** Today, only the Director in the `direct` node produces one. Two more
producers are already designed:

- **Re-routing after a result.** `agents.md` §7 has the Director request a density-adaptive grid
  "only after the complexity score from the first analysis." Walkthrough run B shows that grid
  appearing although it "was not in the original manifest."
- **Chat re-routing.** `agents.md` §5.2 routes chat turns through the same Director.

**Who consumes a manifest.** The `analyse` node runs what is selected. The studio's routing summary
will render both lists, and it parses them with the zod mirror of the contract. Checkpoints hold
the manifest in `RunState`. The Plan Critic and operations may read it later.

**Who consumes the check itself.** Nobody downstream reads the check. It guards the moment a
manifest is produced. Every consumer then relies on one guarantee: a tool missing from both lists
cannot happen, so absence never has to be interpreted.

**Option A — on the shared contract.** Every producer is bound by it, in Python and in TypeScript,
with parity fixtures. The cost is that completeness is judged against `TOOLS` *at validation
time*. `TOOLS` grows in slice 2 with crop candidates, the palette and the grid. After that, every
manifest stored before the change fails to reload, because it never mentioned the new tools. A
re-routing manifest that adds one tool would also have to restate every other tool.

**Option B — at the producer, in the `direct` node.** The Director's output is checked against the
tools it was actually offered. The shared contract and its fixtures do not change. Old manifests
keep reloading as `TOOLS` grows. The cost is that a future producer, such as chat re-routing, has
to apply the same check deliberately. A shared helper in `python/libs/schemas` makes that one
function call rather than a re-implementation.

**Chosen: B.** It checks against the set of tools the Director was offered, which is the
honest meaning of "every tool accounted for." Option A would check against a vocabulary that keeps
changing underneath stored data.

## 11. Not in PR 12

- **The clarifying question** (FR-103). Beat 4 opens with one, but asking it is an interrupt, and
  interrupts are PR 13.
- **Wiring the studio** and rendering the routing summary.
- **Plate delivery.** PNG encoding and a derivatives store come after PR 13.
- **`VisualFindings`**, the Analyst's interpretation, which arrives with the plan.
