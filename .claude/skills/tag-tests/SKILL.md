---
name: tag-tests
description: Backfill test-traceability annotations across a package or directory — inventory the suites, assign a flow and category to each, apply block-level tags, then verify and regenerate. Use when a package shows up under "Untagged" in docs/test-traceability-reports/traceability.md, when adopting traceability in a new area, or when asked to tag/annotate/characterize a batch of existing tests.
---

# Bulk test tagging

For **batches**. A single new test needs no procedure — annotate the block and move on; see
`.claude/rules/testing.md`. This exists because tagging a whole package at once has traps
that cost real time the first time through, all of them recorded below.

Reference: `docs/test-traceability-reports/README.md`. Catalog:
`docs/test-traceability-reports/flows.json`.

## The rule that makes this cheap

**Annotate blocks, not tests.** A module-level `pytestmark`, a `describe`-level `@trace`
comment, or a `test.describe` annotation covers everything inside it. ~1,200 tests in this
repo needed roughly 110 `describe`s + 74 modules, plus overrides only where a block mixes
respects — in practice the a11y cases inside a functional suite.

## Procedure

### 1. Scope it, and check nobody else is in there

Read the **Untagged** section of `docs/test-traceability-reports/traceability.md` — that is
the worklist, per package. Before starting, check `git worktree list` and open PRs: tagging
edits many test files at once, so a package another branch is rewriting is the wrong one to
pick. File disjointness has not been sufficient in this repo.

### 2. Inventory before assigning

Do not assign flows from paths alone. Read what each file says it tests:

```sh
# python — module docstring + test count per file
for f in $(find python/libs python/services -path '*/tests/*' -name 'test_*.py' | sort); do
  doc=$(awk 'NR<=3 && /^"""/{sub(/^"""/,"");print;exit}' "$f")
  n=$(grep -cE '^[[:space:]]*(async )?def test_' "$f")
  printf "%-60s %3s  %s\n" "$f" "$n" "${doc:0:70}"
done

# typescript — first describe title + test count + how many are a11y
for f in $(find apps packages -name '*.test.ts*' -not -path '*/node_modules/*' | sort); do
  d=$(grep -m1 -oE "describe\(['\"][^'\"]+" "$f" | sed "s/describe(['\"]//")
  n=$(grep -cE "^[[:space:]]*(it|test)(\.[a-z]+)*[[:space:]]*\(" "$f")
  a=$(grep -ciE "^[[:space:]]*(it|test).*(accessibility|a11y)" "$f")
  printf "%-64s %3s a11y:%-2s %s\n" "$f" "$n" "$a" "${d:0:40}"
done
```

### 3. Assign, and add a flow rather than forcing one

Pick the flow the tests *serve*, and the category for the respect they verify. If a group
of tests has no honest home, **add a flow to the catalog** — that is a finding, not an
inconvenience. Filing tests under a neighbouring flow because it is close enough makes the
dashboard lie, which is worse than an obviously missing row.

Categories are a closed set: `a11y` `security` `privacy` `safety` `data` `performance`
`functionality`. Prefer `safety` over `functionality` whenever a test pins a grounding or
authorship guardrail — citation enforcement, refusal, or the no-image-generation rule.

**Keep `flows.json` `surfaces` in step with where you tagged — the check enforces this.**
Tagging a flow onto a directory it does not declare is now an error, reported once per
flow+directory with the workspace-root path to paste into `surfaces`. It used to be silent,
and 13 stale pairs accumulated before the check existed. That history is the argument for it
being a hard failure rather than a note: the drift degrades the per-flow drill-down *and*
`suggestFlows` — the "flows on this surface: …" hint an author sees when their new test is
untagged — so it bites hardest exactly when someone is trying to do the right thing.

Watch what a new surface implies before adding it: `expect.whenSurfaceMatches` turns an
`^apps/` surface into an expected `a11y` category, so adding an `apps/` path to a flow that
has no meaningful a11y surface area manufactures a permanent false gap. When that happens,
suspect the *tag* rather than the catalog. Reaching for a data-handling flow on a test that
merely verifies scoping in the privacy respect is the usual cause — flow is what the test
is *about*, category is the respect it verifies, and `critique.alignment` + `privacy` says
that far better than a dedicated privacy flow + `privacy` does.

### 4. Apply

Write a throwaway script in the scratchpad rather than editing files one at a time, keyed
by an explicit `file → [flow, category]` map so every assignment stays reviewable. Make it
idempotent (skip files that already contain `@trace` / `pytest.mark.trace`).

**Four traps, all of which produced silent wrong output the first time:**

1. **Multi-line imports.** Inserting `pytestmark` after "the last import line" splices into
   the middle of a `from x import (` block and breaks the file. Consume each import
   *statement* whole by tracking paren depth, and skip the module docstring first.
2. **More than one top-level block per file.** Tagging only the first `describe` leaves the
   rest inheriting nothing. Tag them all — and check whether a second block deserves a
   *different* flow (a `critique.spec.ts` may hold both analysis and alignment).
3. **`describe.each(...)('%s', …)`** has no literal title, so a regex expecting a quoted
   string skips it entirely and its tests silently go untagged.
4. **Import order.** Appending `import pytest` after the last import violates ruff's `I001`.
   Just run `ruff check --fix` afterwards.

### 5. Verify — in this order

```sh
uv run --directory python ruff check --fix python/ && uv run --directory python ruff format python/
uv run --directory python pytest --collect-only -q   # a bad flow fails HERE, exit 4
pnpm traceability:check
pnpm traceability:fix                                # lowers the untagged ratchet
pnpm traceability:report
pnpm format                                          # AFTER the report — see below
pnpm format:check                                    # husky runs this; it must be clean
pnpm lint:md                                         # the generated pages must satisfy it
```

**`pnpm format` must come after `traceability:report`, not before.** The report writes
`traceability.json`, and the generator's JSON is not in Biome's canonical shape — a short
array it prints expanded, Biome collapses to one line. Formatting first therefore leaves a
tree that fails `format:check`, and husky blocks the commit on it. Formatting last also
means the freshly-written `traceability.json` is the thing being normalized.

Then re-run `pnpm traceability:check`: `pnpm format` only rewrites whitespace, but it is
cheap to confirm the count is still `0 untagged` rather than assume it.

Then confirm the numbers moved as expected: tagged up, untagged down by the same amount,
and the package gone from the Untagged table. Cross-check the parser against ground truth
if anything looks off —
`grep -cE '^[[:space:]]*(async )?def test_'` and the `it(`/`test(` equivalents should match
the per-runner totals exactly.

### 6. Report what you could not place

Any test you could not confidently assign stays untagged and gets named in the hand-off,
with why. A guessed flow is worse than an untagged test: untagged is visibly absent from
the matrix, a wrong tag is invisibly wrong in it.
