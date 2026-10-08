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
- Learning and keychain unit tests: 77 passing after review fixes.
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
The revised full run is recorded separately at `live-v2.json`.
It passed all gates: 20/20 gold retrieval hits, MRR 0.7767, zero execution errors,
and all 32 cases passed correctness, support, medium, and expected-status checks.
All 12 expected evidence gaps abstained. These scores are model-assisted results
on a small curated regression set, not a guarantee for arbitrary questions.

The run used `claude-opus-5` for both synthesis and judging and
`text-embedding-3-small` for retrieval. The same-model judge can share mistakes
with synthesis; review cited excerpts manually before broader rollout.

## PR review fixes

Automatic and CLI Greptile review identified twelve distinct issues. Fixes bound the
metrics flush, move keychain lookup off the request thread, support interrupted
vector rebuilds, avoid duplicate nested quotations, align Python/Zod response
validation and defaults, evaluate conversational retrieval, suppress stale success
announcements, handle token stops deliberately, and name the example group with
semantic HTML. Focused regression tests cover these paths.

Re-ingestion after the quotation fix produced the same corpus checksum and counts
for the downloaded editions. The original 32 cases have no history, so their query
strings and retrieval results are unchanged. The new follow-up suite is evaluated
separately. A first topic-switch run exposed history overwhelming an explicit new
topic; the shared query helper now carries history only for underspecified follow-ups.

A subsequent follow-up run found one unsupported detail in an overlong comparative
answer. The synthesis prompt now asks for one supported point per claim, checks
all list details against their specific citations, and prefers direct evidence
over optional historical comparisons. Earlier failed reports remain local for audit.

The follow-up suite also checks a generic Spanish practice question and a short
Spanish topic switch in unit tests. The live eval carries each case’s locale into
synthesis, using the same history and retrieval-query helper as the request route.

After the review changes, a fresh 32-case run (`pr-review-final.json`) passed the
existing gates: 20/20 retrieval hits, MRR 0.7767, zero errors, 100% correctness
and support, 96.875% medium appropriateness, and all 12 expected gaps abstaining.
The [current baseline](live-baseline.json) records that run, including the judge
flagging one charcoal answer for repeating a historical shellac-fixing technique
without a caveat. This remains a POC limitation: a passing aggregate gate does not
mean every answer is appropriate. Human review is required before broader rollout.

The first Spanish follow-up run produced a supported answer but missed its
retrieval gate: incidental Spanish words matched unrelated English passages.
Spanish queries now use semantic ranking when vectors are available. A manually
verified Speed passage defining hatching and parallel lines is an additional valid
gold anchor for this case. Its earlier failed report remains local.

The branch also includes main’s `6c534cb` session-note update, merged without conflicts.

The updated [follow-up baseline](followup-baseline.json) passes all four cases:
4/4 gold retrieval hits, MRR 0.6458, zero errors, and 100% correctness, source
support, and medium appropriateness. It has no expected evidence gaps, so
abstention is unmeasured. The original 32 English queries and synthesis prompt
are unchanged by this locale-specific correction.

The final on-PR review also caught consecutive generic follow-ups losing the
original subject. Retrieval now walks back to the latest explicit user topic,
skipping generic follow-ups and preserving explicit topic switches. English and
Spanish three-question regressions cover this path; the live suite includes a
repeated hatching follow-up. The parallel final CLI review raised no findings.

A final comparison regression distinguishes generic turns from subject-bearing
follow-ups: “How does it compare to scumbling?” stays in the query together with
the earlier glazing topic. Only purely generic turns are skipped. English and
Spanish tests cover this distinction; the existing eval queries remain unchanged.
