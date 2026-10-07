# POC validation

The initial corpus contains 963 passages from the three downloaded editions.
[Retrieval baseline](retrieval-baseline.json) records its checksum, thresholds,
scores, and failed retrieval cases. The generated corpus and detailed reports
remain under `python/learning-corpus` and `python/learning-eval-reports` and are
ignored by Git.

## Completed checks

- Both provider keys authenticated with HTTP 200 model-list responses before paid use.
- Vector indexing completed with `text-embedding-3-small`, 1,536 dimensions,
  and 344,042 embedding tokens.
- Keyword retrieval: hit-at-six 85% (17/20), MRR 0.7375, zero execution errors.
- Learning and keychain unit tests: 52 passing.
- All TypeScript workspace tests passed after updating the route-gate snapshot
  for the authenticated learning page and API.
- TypeScript type checks, lint, translation checks, and Python lint passed.
- All three production builds and bundle-size checks passed after syncing main.
- Chromium, Firefox, and WebKit browser tests passed at 390px and 1,280px, including WCAG axe checks,
  citation disclosure, and no horizontal overflow. Responses are mocked in this test.

## Broader Python suite

After syncing main to `a3e55c7`, the full suite produced 717 passing tests,
one skipped existing paid smoke test, and five failures in existing database
integration tests. The local database contains seeded image/detection rows beyond
those expected by their fixtures (the repository tracks this as issue #48).
No database reset or fixture deletion was performed.

The five failures were in `test_projects_rls.py` and `test_screening_detections.py`.
Focused learning/config checks are hermetic and pass. Before the sync, the metrics
policy test also failed; the merged operations change fixed that expectation.

## First live run and corrections

The first 32-case live run failed its gates: 11 execution errors and one gap response
that included uncited historical exhibition details. Completed answered cases passed
the semantic rubric. Failed judge calls originally discarded their retrieval rows,
so that run's retrieval score also reflected pipeline failures.

The corrections keep answers focused, enlarge the judge output budget while asking
for a short reason, preserve intermediate results when judging fails, and replace
model-written gap explanations with localized fixed text. Regression tests cover
uncited facts in gaps and preservation of retrieval results on judge truncation.
The original full report is retained locally at `python/learning-eval-reports/live.json`.
The revised full run is recorded separately at `live-v2.json`. Its repository
[baseline summary](live-baseline.json) records per-case scores and source-set hashes.
It passed all gates: 20/20 gold retrieval hits, MRR 0.7767, zero execution errors,
and all 32 cases passed correctness, support, medium, and expected-status checks.
All 12 expected evidence gaps abstained. These scores are model-assisted results
on a small curated regression set, not a guarantee for arbitrary questions.

The run used `claude-opus-5` for both synthesis and judging and
`text-embedding-3-small` for retrieval. The same-model judge can share mistakes
with synthesis; review cited excerpts manually before broader rollout.
