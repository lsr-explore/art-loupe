# Test traceability

Which application flow is verified by which tests, and in what respect — across pytest,
Vitest and Playwright.

- **[`flows.json`](flows.json)** — hand-authored catalog. The source of truth, and the only
  file here you edit by hand.
- **[`traceability.md`](traceability.md)** — generated summary: flows grouped by area, with
  a category breakdown, per-area subtotals and a grand total.
- **`flows/<flow-id>.md`** — generated detail, one page per flow: every covering test by
  name, file and line, grouped by runner. Linked from each row of the summary.
- **[`traceability.json`](traceability.json)** — the same data, machine-readable.

The summary answers *"is this area covered, and in what respect"*. The detail pages answer
*"covered by what, exactly"* — when a defect lands against a flow, the test **names** are
what tell you whether that case was already contemplated.

## Why this exists, and why it might survive

Prior attempts at this — in this repo and in the Jira/Xray-shaped tools it's modelled
against — died the same way: the map lived in a *different system from the code*, linked by
an ID that nothing validated, so the first rename orphaned it silently and nobody trusted
it enough to maintain it.

Three things are different here:

1. **The annotation lives next to the test**, so it moves and dies with that test.
2. **A wrong tag fails the build.** An unknown flow fails pytest *collection* — not a
   warning, an `ExitCode.USAGE_ERROR` before any test runs — and fails `pnpm
   traceability:check` independently of it.
3. **The tags drive test selection**, so they earn their keep daily rather than only when
   someone asks for a report. A map nobody runs against is a map that rots.

## Tagging a test

One line, next to the test. Untagged tests simply don't appear in the matrix — adoption is
incremental, and *missing* is reported, never failed.

```python
# python — module-level default, per-test override
pytestmark = pytest.mark.trace(flow="critique.formal-analysis", category="functionality")

@pytest.mark.trace(flow="critique.formal-analysis", category="safety")
def test_febrile_reading_inside_window_blocks() -> None: ...
```

```ts
// vitest — comment above the block; a per-test comment overrides it
// @trace flow=critique.formal-analysis category=functionality
describe('CritiquePanel', () => {
  // @trace category=a11y
  it('has no accessibility violations', async () => { /* … */ });
});
```

```ts
// playwright — the native `annotation` field of TestDetails
test.describe('Critique panel', {
  annotation: [{ type: 'flow', description: 'critique.formal-analysis' }],
}, () => {
  test('has no detectable accessibility violations', {
    annotation: [{ type: 'category', description: 'a11y' }],
  }, async ({ page }) => { /* … */ });
});
```

**Annotations inherit.** A module-level `pytestmark`, a `describe`-level comment, or a
`test.describe` annotation covers everything inside it; the nearest annotation wins. Only
tests that differ from their block need their own line.

### Why Playwright uses `annotation:` and not `tag:`

Because `tag:` is **not silent**. Playwright's terminal reporters append tags to every
result line — `formatTestTitle()` in `playwright/lib/runner/index.js` ends with
`${extraTags.length ? " " + extraTags.join(" ") : ""}` — so tagging would have put a suffix
on all 98 e2e result lines. Annotations are serialized only by the JUnit, JSON and HTML
reporters, so the HTML report shows them and `--reporter=list` stays clean.

The tradeoff is real and deliberate: **`annotation:` cannot be selected with
`playwright --grep`.** Use `pnpm traceability:run` (below) instead, which resolves matching
spec files from the catalog.

Vitest gets a comment because it has no quiet slot at all: `TestOptions` has no custom key,
and `context.annotate()` is surfaced by reporters.

## Commands

```sh
pnpm traceability:report    # regenerate traceability.md + traceability.json
pnpm traceability:check     # validate only — this is what CI runs
pnpm traceability:fix       # rewrite non-canonical categories (accessibility → a11y)
```

Run only the tests protecting a flow:

```sh
# pytest selects natively, via python/conftest.py
uv run --directory python pytest --flow critique.formal-analysis
uv run --directory python pytest --category safety

# all three runners, resolved from the catalog
node scripts/reports/traceability-report.mjs --run --flow critique.formal-analysis
node scripts/reports/traceability-report.mjs --run --category a11y
```

`--run` resolves matching *files* for Vitest and Playwright and passes them as path
filters; pytest gets `--flow`/`--category` and does its own deselection. An unknown value
is a usage error, never an empty run — `--flow raediness…` quietly matching nothing is how
a green board comes to mean nothing.

## Adding or changing a flow

Edit [`flows.json`](flows.json), then `pnpm traceability:report`. Each flow needs an `id`,
`title`, `severity` (`P0`–`P3`), a `rationale` saying *why that severity*, and the
`surfaces` it lives on.

Severity is **harm severity**, not demo risk: `P0` means a failure there can fabricate an
attribution or citation, or make the system produce imagery it must never produce. It is a
property of the flow, inherited by its tests.

The `expect` block declares what a flow of a given severity should carry — today, every
`P0` should have a `safety` test, and anything with an `apps/` surface should have an
`a11y` test. Shortfalls appear under **Gaps**; they are reported, never failed. A missing
safety test is a conversation, not a broken build.

## What the check enforces

Hard failure:

- an unknown flow id, or an unknown category
- a **non-canonical** category — `accessibility` where the canon is `a11y`. The alias table
  in `flows.json` is what makes this decidable; `--fix` rewrites them.
- a malformed annotation — an unknown key like `flw=`, a Playwright annotation entry that
  isn't `{ type, description }`, or a `@trace` comment binding to nothing
- a half-annotation — a flow with no category, or a category with no flow
- catalog integrity — duplicate ids, a bad severity, an alias pointing at a non-category

Reported only: untagged tests, flows with no covering test, and expected-category
shortfalls.

## Limits — read before quoting a number

A tag records that a test is *about* a flow. **It does not claim the flow is adequately
covered.** Twenty shallow render assertions and twenty boundary-value tests are
indistinguishable in the table. Read a row as *"here is where to look"*, never as *"this is
safe"*. `traceability.md` repeats this where the numbers are, deliberately.

Counts are **declarations**: a parametrized test counts once regardless of how many cases
it expands to, and a Playwright row counts once rather than once per browser project.
Exact runtime case counts would require executing the suites, which would make the doc
depend on a green run.

## The other half — coverage contexts (Python, local)

This dashboard maps **requirement → test**. `coverage.py` contexts map **test → code**:
*"which tests exercise this line"*, with zero annotation and no staleness, because it is
execution-derived rather than declared.

```sh
uv run --directory python poe test-cov-contexts   # then open python/htmlcov/index.html
```

Every covered line in the report lists the test functions that executed it — about 3,000
lines across 73 source files. Contexts are pytest nodeids, so parametrized cases stay
distinct rather than collapsing into one entry per function.

Chained with the flow marks, the two halves answer a question neither can alone:
`rules.py:110` ← 3 covering tests ← all tagged `retrieval.grounding` / `safety`. A line of
the citation-enforcement path can be shown to be protected by three safety tests of the
grounding flow, and lines with **no** covering safety test become findable. Only the first arrow is
hand-maintained.

Two limits, both deliberate:

- **Python only.** Vitest has no equivalent to `dynamic_context`. The nearest JS answer is
  `vitest related <file>`, which is file-level and import-graph-based rather than
  line-level.
- **Local only.** Coverage does not run in CI, so there is no published report and no trend.

Pass `--cov=artloupe` (the package). A dotted module path such as `--cov=artloupe.agent.rules`
fails collection with `KeyError: 'pydantic.root_model'`.

## Not built

**Pass/fail state.** This reports what is tested, not what is green. Joining results would
couple the doc to a test run and duplicate what CI already reports.
