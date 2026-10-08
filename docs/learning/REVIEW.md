# Review: PR #92 book-grounded learning assistant

**Reviewed:** 2026-10-07

The code in PR #92 is careful at its boundaries, but the PR goes against a settled decision
without an ADR and adds a second AI vendor.

This review covers [PR #92](https://github.com/lsr-explore/art-loupe/pull/92), which adds a
book-grounded learning assistant. It also covers the squash commit
[019afc0](https://github.com/lsr-explore/art-loupe/commit/019afc0ef1ef875265173638796f3c3c04c59240).
The commit is the PR's five commits squashed together, so the two get one review. Codex wrote
the change.

## Decisions for the project owner

These four items are not code bugs. Each one is a call about architecture, process, or scope.

1. **The PR does not follow a settled decision.**
   `docs/decision-records/settled-decisions.md:66` says "pgvector enabled from the start — the
   retrieval corpus is the first real workload." The pgvector migration already exists. This PR
   builds a file-based BM25 + numpy index instead (`retrieval.py`). The PR body says this avoids
   a migration for a 963-passage POC. That reason may be fine, but no ADR records it, so the
   settled decision no longer matches the code.
2. **The PR adds OpenAI as a second AI provider, and no ADR covers it.** Learners' questions
   are sent to OpenAI to be embedded (`embeddings.py:17`). The whole corpus is sent at embed
   time. The UI's privacy line does mention "the embedding provider." Still, a new data
   processor is the kind of commitment that belongs in an ADR.
3. **The feature is outside the project charter.** `CLAUDE.md` describes Art Loupe as
   reference photo → working plan. A general art-Q&A chat is a new product surface. The home,
   project, and inspiration pages all link to it. This point does not apply if the scope was
   already approved.
4. **The feature is not deployed, but the links to it are live.** `docs/learning/README.md:86`
   says "No deployment was performed." The corpus is git-ignored, and
   `ARTLOUPE_LEARNING_CORPUS` must point at a local directory. Without the corpus, every
   question returns 503, and the UI shows "unavailable." The home page link is unconditional
   (`home/page.tsx`). What is set in production has not been checked.

## Evaluation quality

The reported scores are probably optimistic. The eval set is small, partly fitted to the
retrieval code, and graded by the same model that writes the answers.

- **The keyword retrieval looks tuned to the test set.** The stopword list in
  `retrieval.py:16-83` includes "consider", "say", "give", and "great." Those are not standard
  stopwords. "consider", "say", and "give" appear word for word in eval questions
  (`eval-cases.json:232, 292, 307`). No held-out set exists. That means the offline score
  (17/20, MRR 0.7375) partly measures fit to these specific 20 questions.
- **The negative cases are thin, and abstention depends entirely on the model.** The set has
  20 answerable cases and only 12 "should abstain" cases: 7 gap, 3 injection, and 2 medium.
  All 12 are in English. Keyword retrieval has no score floor, so any question that shares one
  term with the books goes to synthesis. Only the model's judgment then produces an evidence
  gap.
- **The answer model also grades itself.** The answerer and the judge both default to
  `claude-opus-5`. The PR acknowledges this. Keep it in mind when the 100% scores get quoted.

## Code-level findings

None of these findings blocks the POC. The first three are worth fixing before the feature is
used more widely.

| Finding | Location | Detail |
| --- | --- | --- |
| Keyword mode breaks Spanish text | `retrieval.py:87` (`terms()`) | The regex `[a-z]+` turns "composición" into "composici" and drops the "n". Hybrid mode skips keyword search for `es`, so only keyword-only Spanish is broken. The docs describe this only partly. |
| User-facing copy is hard-coded in Python | `answering.py:77-80`, `:135-137` | The English and Spanish gap messages bypass next-intl. A cleaner design returns a code and lets Studio translate it. |
| The follow-up heuristic is brittle | `retrieval.py:208` (`_is_followup`) | Any question under 8 words that contains "it", "this", or "that" counts as a follow-up, so earlier topics get mixed into its query. |
| The answer is screened twice | `routes.py:61`, `answering.py:99` | `usable()` runs in the route and again inside `synthesize`. |
| The index cache never invalidates | `retrieval.py:196` | `load_index` uses `lru_cache`, so a re-ingested corpus needs a restart. |
| Upstream error codes are inconsistent | `apps/studio/src/app/api/learning/route.ts:89` | A malformed upstream body returns 503. Other upstream failures return 502. |
| The medium list is duplicated | `learning-chat.tsx:198` | The list is copied instead of coming from the schema enum. |
| The judge can raise StopIteration | `evaluation.py:91` | `next(...)` has no default value. A broad `except` catches the error anyway. |

## What is solid

The citation and trust boundaries are well built.

- Citation IDs are resolved on the server, and unknown IDs are rejected (`answering.py:51`).
- Both Python and Zod check that the cited IDs and the returned sources match exactly.
- A gap explanation from the model is replaced with fixed text, so it cannot carry uncited
  facts.
- Retrieved passages pass through the existing `retrieved-document` screening before
  synthesis.
- The prompt payload escapes `<`, `>`, and `&`.
- The Studio proxy caps the request body at 64 KB and refuses redirects.
- `/api/learning` gets the same route-gate treatment as the other API routes.
- The chat UI covers the accessibility basics. It has real labels, 44px targets, citations
  that open their `<details>`, a polite live region, and `role="alert"` for errors.
- Paid CLI steps require `--allow-paid` or `--live`.
- Ingestion writes are atomic.

## Commit and next steps

The squash commit message is clean. Its conventional title matches the PR, and it credits Codex
as co-author. I found no other problems in the commit.

- [ ] Decide on the four owner decisions above (pgvector divergence, OpenAI provider, charter
      scope, live links to an undeployed feature)
- [ ] Choose a route for the evaluation and code-level findings: backlog issues, an ADR, or a
      follow-up PR
