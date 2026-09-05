# Retrieval

- **Status:** Draft for review — fourth of the `docs/design/` set
- **Date:** 2026-08-31
- **Deciders:** Laurie Reynolds
- **Related:** [`requirements.md`](./requirements.md) · [`agents.md`](./agents.md) ·
  [`e2e-walkthrough.md`](./e2e-walkthrough.md)

The proposal listed eight design documents and folded retrieval into `architecture.md`. That
was wrong. Retrieval is not a subsystem of the architecture here — it is one of the three
evidence classes the entire product rests on, and with the Week 9 fine-tune cut it is the
largest technical claim the capstone makes. It gets its own document.

## 1. Why this is load-bearing

Every sentence Art Loupe produces is `measured`, `cited`, or `chosen`. Deterministic tools
own `measured`; the Planner owns `chosen`. **`cited` is retrieval, and nothing else produces
it.** If retrieval is weak, a third of the evidence taxonomy is decoration and the product's
central claim — that a plan is inspectable, claim by claim — is false.

That sets a harder bar than "the answers seem relevant." Three properties are required, in
this order:

1. **Every `cited` claim resolves** to a real passage the artist can open (FR-504). A
   citation that 404s is worse than no citation, because it manufactures confidence.
2. **The passage actually supports the claim.** Resolving is necessary, not sufficient.
3. **Nothing above the floor means nothing** (FR-506). The system says it does not know
   rather than falling back to unattributed recall.

Failing 1 or 2 is the confabulation failure this project exists to prevent. It is a P0.

## 2. Three retrieval paths, and one that does not exist

| Path | What | Mechanism | Indexed |
| --- | --- | --- | --- |
| **Corpus** | technique, materials, and vocabulary instruction | hybrid dense + sparse over our own chunks | yes |
| **Live object lookup** | museum artwork metadata for examples | HTTP by identifier, cached | no |
| **Never** | model recall presented as a source | — | — |

The third row is not a joke. The most likely way this system produces a false citation is not
a retrieval bug — it is a model writing a plausible sentence about *alla prima* and attaching
a chunk ID that came back for something else. §9 is the enforcement that makes that a failure
rather than a paragraph.

**Museum collections are not ingested.** Object metadata is fetched live by identifier and
cached, which keeps rights simple and the corpus small. Getty linked open data is out.

## 3. The corpus

Small and curated: **hundreds to low thousands of chunks**, not a scrape. Every chunk is
reachable by a human reviewer, which is what makes per-fact citation credible at this size.

### 3.1 Three source classes

| Class | Content | Feeds |
| --- | --- | --- |
| **technique** | how to do the thing — value massing, edge control, glazing, construction | reference assessment, plan stages, chat |
| **materials** | paper surface / weight / tooth, brush shape and size ranges, pencil grades, dilution and drying | **the plan's materials list (FR-607)** and materials chat |
| **vocabulary** | term definitions — *grisaille*, *alla prima*, *lost edge*, *cold-press* | `get_vocabulary_term`, and query expansion (§8) |

The materials class is the newest and the least well served by the obvious sources. Museum
educational essays cover technique well and materials barely at all, so this class needs its
own open-licence sourcing — and because every plan now carries a materials list, **it is on
the plan critical path**, not a chat nicety.

### 3.2 The licence gate

A document that has not had its terms read does not enter the corpus. Ingestion refuses it —
this is a gate, not a warning. Each source carries a verdict on the `docs/media-assets.md`
model: ✅ ingest and cite · ⚠️ conditions recorded · ❌ refuse.

Every chunk carries `institution`, `url`, `licence`, `retrieved_at`, and `source_class`. A
chunk missing any of them is not retrievable (FR-502) — enforced as a `NOT NULL` constraint,
so it cannot be violated by a code path that forgets.

## 4. Ingestion

```text
 fetch ──▶ licence gate ──▶ extract ──▶ normalise ──▶ chunk ──▶ enrich ──▶ embed ──▶ index
   │            │              │            │            │          │          │        │
 by URL      verdict        HTML/PDF     strip nav,   §5        medium,    §6.1     dense +
 recorded    required       → text       boilerplate            skill,              sparse
                            + headings                          concept,
                                                                source_class
```

- **FR-508** Ingestion is **idempotent by content hash.** Re-ingesting an unchanged document
  is a no-op; a changed one supersedes its chunks and records that it did. Embeddings are
  never silently orphaned.
- **FR-509** Every ingestion run writes a record: source count, chunk count, refusals with
  reasons, embedding model and dimension, duration. `apps/operations` renders it, which is
  the corpus half of the ingestion panel ported from `veloce-trace`.
- **FR-510** A document failing the licence gate is refused with its reason recorded. Refusal
  counts are visible; a silently skipped source is a bug.
- **FR-511** Ingestion runs offline, never in a request path, and never as a graph node. It
  is a service, not an agent.

## 5. Chunking

Instructional art prose is short-sectioned and heading-dense, which is unusually kind to
retrieval. The strategy follows that structure rather than fighting it:

- **Heading-aware splits.** A chunk never spans two sections. The heading path is prepended
  to the chunk text so "Paper → Cold-press" travels with the body, which materially helps
  both legs.
- **300–600 tokens**, with roughly 15% overlap at section boundaries only.
- **Vocabulary terms are never split.** A definition and its term stay in one chunk, because
  a definition severed from its term is retrievable by neither leg.
- **Tables become rows, not prose.** Materials data is frequently tabular — paper weights,
  brush sizes — and flattening a table into a paragraph destroys exactly the exact-match
  tokens §6.2 depends on.
- **Passage spans are recorded** so a citation can point at the sentence, not just the chunk
  (§9).

## 6. The two legs

### 6.1 Dense

pgvector with an **HNSW** index. Cosine distance. `m = 16`, `ef_construction = 64`,
`ef_search` tuned against the gold set rather than guessed.

`python/.env.example` already carries `ARTLOUPE_RETRIEVAL_BACKEND=pgvector`, so the seam
exists; nothing implements it yet.

The embedding model is **not chosen**, and choosing it is a real commitment: dimension is
baked into the column and the index, so a change is a full re-embed and a re-index. The
criteria that should decide it — cost per million tokens at corpus scale, dimension against
index size, and measured recall on our own gold set, not a public benchmark — are in §14.

### 6.2 Sparse

Postgres full-text search over a `tsvector`, with the corpus's own vocabulary as a dictionary.

This leg exists because **art vocabulary is full of exact-match terms that dense retrieval
smears**, and the failure is quiet:

| Query term | What dense does | What sparse does |
| --- | --- | --- |
| *grisaille* | pulls generic "monochrome underpainting" passages | finds the passages that use the word |
| *Loomis* | pulls "head construction" broadly | finds the method by name |
| *cold-press* | pulls "watercolour paper" generally | separates it from hot-press |
| *300gsm* / *140lb* | near-useless — numerals embed poorly | exact |
| *2B* vs *6B* | frequently indistinguishable | exact |

The materials class is where this leg earns its place outright. "What weight paper?" is
answered in numbers, and numbers are the thing dense retrieval is worst at.

**An honest caveat that belongs in the write-up:** Postgres FTS ranks with `ts_rank_cd`,
which is *not* BM25 — it has no document-length normalisation and no saturating term
frequency. For a curated corpus of uniform-length chunks the difference is small, and RRF
consumes ranks rather than scores, which absorbs much of it. Starting with `ts_rank_cd` and
measuring is the right call; adding a real BM25 extension is a fallback if the gold set says
the sparse leg is underperforming. **Calling `ts_rank_cd` "BM25" in the submission would be
the kind of imprecision that costs more credibility than the gap itself.**

### 6.3 Why both, concretely

| Query | Dense alone | Sparse alone | Hybrid |
| --- | --- | --- | --- |
| "how do I keep the shadow side from going flat?" | good — concept match | poor — no shared terms | good |
| "cold-press or hot-press?" | mediocre — both are "watercolour paper" | good | good |
| "what does grisaille mean for a graphite drawing?" | half — finds grisaille-adjacent | half — finds the term, misses the graphite framing | good |

The third row is the argument. Neither leg alone answers a question that is simultaneously
conceptual and terminological, and most real artist questions are exactly that.

## 7. Pre-filters run before fusion, not after

Metadata filters — `medium`, `skill_level`, `concept`, `source_class`, `rights` — are applied
**inside each leg's query**, not as a post-filter over fused results.

Post-filtering silently shortens the result list and distorts the fusion: a leg whose top ten
are all wrong-medium contributes nothing, but RRF cannot tell that from a leg that legitimately
found nothing. Pre-filtering keeps both legs contributing k real candidates.

Practically, this is what makes `irrelevant_medium_advice` (FR-702) rare rather than routine.
Colour-mixing guidance never reaches a graphite plan because it was never retrievable for one.

## 8. Query construction

The **Art Tutor** formulates queries; it does not pass the artist's sentence through. Three
shapes, matching the three chat routes in `agents.md` §5.2:

| Shape | Built from | Expanded with |
| --- | --- | --- |
| technique | the finding or stage that prompted it | vocabulary-class synonyms for the concept |
| materials | medium + support size + time + skill from `ProjectIntent` | the unit forms — gsm *and* lb, both spellings of colour |
| vocabulary | the term itself | nothing; exact match is the point |

Query expansion draws on the vocabulary class of our own corpus rather than a general
thesaurus, so expansions are always terms the corpus actually uses.

The materials shape is the one that runs unprompted, on every plan, to build the FR-607 list.

## 9. From chunk to citation

Retrieving a passage and citing it are different acts, and the gap between them is where
confabulation lives. Three gates, all deterministic middleware, none of them a model:

1. **Resolution.** Every `Cited` claim's `chunk_id` must exist and be live. Unresolvable is a
   hard failure of the run, not a lint (FR-504).
2. **Support.** The claim must be entailed by the cited passage span. A claim citing a chunk
   that does not contain it is `missing_evidence` (FR-702) — the Plan Critic's, and the
   middleware's, most important check.
3. **Floor.** Below the relevance floor the Tutor returns empty and says so (FR-506).
   Abstention is a success state; a confident unsourced sentence is not.

Retrieved documents are **untrusted data** (FR-505). An instruction inside a retrieved
passage is recorded as a detection on the `retrieved_doc` surface and never followed —
the same rule as EXIF and OCR text, different surface.

## 10. No reranker, and why

There is no cross-encoder rerank stage. RRF's fused order is the final order.

The reranker was the Week 9 fine-tuning proposal, and cutting the fine-tune removed its
reason to exist: a zero-shot cross-encoder would add a model dependency, latency inside
NFR-03's budget, and a second thing to evaluate, in exchange for reordering a candidate list
that is already short and already filtered. **This is a deliberate omission, and
`learning_mapping.md` should name it as the Week 9 gap rather than let the hybrid story
imply coverage.**

If the gold set later shows fusion ordering is the binding constraint on answer quality, the
seam to add one sits between §6 and §9 and touches nothing else.

## 11. Live museum lookup

A separate path with its own failure mode. Object metadata comes from The Met, the Art
Institute of Chicago, and the Smithsonian, fetched by identifier and cached.

- It supplies **examples**, never claims. A painting is shown; nothing is asserted about it
  beyond its own metadata.
- Timeouts and retries are bounded, and the degraded mode is defined: lessons ship without
  live examples and say so (NFR-05). A museum being down never fails a run.
- Cached by identifier with the fetch date recorded, so a stale example is visibly stale.

## 12. Data model and access

```text
sources        id, url, institution, licence, verdict, verdict_date, source_class
documents      id, source_id, content_hash, retrieved_at, superseded_by
chunks         id, document_id, heading_path, text, span, medium[], skill_level[],
               concept[], tsv (generated)
embeddings     chunk_id, embedding vector(N), model, dimension
ingestion_runs id, started_at, counts, refusals, model, dimension
```

**The corpus is not artist data**, and that distinction matters for RLS. Artist projects,
uploads, plans, and transcripts are row-level-secured to their owner via `auth.uid()`. The
corpus is **public-read to any authenticated principal and writable only by the ingestion
service role** — there is no per-artist corpus. Applying ownership RLS to corpus tables would
be cargo-culted security that breaks retrieval for everyone.

`supabase/` currently holds one migration enabling pgvector and nothing else. Every table
above is unbuilt.

## 13. Evaluation

Retrieval is the one component here with real, cheap, quantitative evaluation, and the
operations dashboard should show it (FR-906).

**Gold set:** 60–100 queries drawn from the two worked examples and from realistic beginner
and intermediate questions, each with judged relevant chunks. Hand-authored, versioned in the
repo, and — because it is authored against our own corpus — the only benchmark that means
anything for this system.

| Metric | Answers |
| --- | --- |
| recall@k | did the right passage come back at all |
| nDCG@10 | is it near the top |
| MRR | how far does the Tutor read before it finds it |
| citation-resolution rate | must be 100%; anything else is a P0 |
| unsupported-claim rate | §9 gate 2, measured rather than assumed |
| abstention rate | too low means it is guessing; too high means the corpus is thin |

**The A/B is the headline.** Dense-only, sparse-only, and fused, over the same gold set,
rendered side by side. It is what turns "we implemented hybrid retrieval" into "here is what
each leg contributes and where each one fails," and it is the strongest single artifact
Week 7 can produce.

Run it in CI on corpus change, so a bad ingest shows up as a metric regression rather than as
a wrong answer in a demo.

## 14. Open questions

- **Embedding model and dimension.** Undecided, and it is the most expensive thing here to
  change later — dimension is baked into the column and the HNSW index, so revisiting means a
  full re-embed and re-index. Decide it against the gold set before the corpus is built out,
  not after.
- **`ts_rank_cd` or a real BM25 extension.** §6.2. Start with what Postgres gives, measure,
  and only add a dependency if the sparse leg underperforms. The naming discipline holds
  either way.
- **Corpus size target.** "Hundreds to low thousands" is a range, not a plan. The materials
  class needs its own number, since it now gates every plan.
- **Materials sourcing.** The open question with a dependency attached: no licence-cleared
  materials sources means no complete plan (FR-607).
- **Who authors the gold set**, and against which corpus snapshot. Unresolved, and it blocks
  every metric in §13.
- **Does the sparse leg need its own dictionary?** Art vocabulary includes terms an English
  stemmer mangles and hyphenated compounds (*cold-press*, *alla prima*) that tokenise badly.
  A custom dictionary may be needed; measure before building one.
