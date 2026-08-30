# Test Conventions

- **Co-located test files** — place `*.test.ts` / `*.test.tsx` next to the source file.
- **Mock data in separate files** — keep mock/fixture data shareable, not inline in tests.
- **Vitest** for unit and component tests. **Playwright** for e2e (under `apps/*/e2e/`).
- **Accessibility assertions** — use `vitest-axe` or `@axe-core/playwright` for a11y coverage on interactive components.

## Traceability annotations

Every test declares which application **flow** it verifies and in what **respect**. The
catalog of valid values is `docs/test-traceability-reports/flows.json`; a wrong value fails
pytest collection and `pnpm traceability:check`. Full reference:
`docs/test-traceability-reports/README.md`.

**Annotate the block, not each test** — module-level `pytestmark`, a `describe`-level
comment, or a `test.describe` annotation covers everything inside it. Only override where a
test differs from its block, which in practice is a11y cases inside a functional suite.

```python
pytestmark = pytest.mark.trace(flow="critique.formal-analysis", category="functionality")
```

```ts
// @trace flow=critique.formal-analysis category=functionality
describe('CritiquePanel', () => {
  // @trace category=a11y
  it('has no accessibility violations', async () => { /* … */ });
});
```

```ts
test.describe('Critique panel', {
  annotation: [{ type: 'flow', description: 'critique.formal-analysis' }],
}, () => { /* … */ });
```

- Categories are a **closed set**: `a11y` `security` `privacy` `safety` `data`
  `performance` `functionality`. Never `accessibility` — the check rejects non-canonical
  spellings and `pnpm traceability:fix` rewrites them.
- Playwright uses `annotation:`, **not `tag:`** — tags print on every terminal result line.
- A new test inside an already-annotated block needs nothing; it inherits.
- A **new test file or new top-level block** must carry an annotation. `untagged-baseline.json`
  is a ratchet that fails CI when a package's untagged count rises, so this is enforced, not
  merely requested. Never raise a baseline number to silence it without saying why.
- **Tagging a flow in a new directory means updating that flow's `surfaces`.** The check fails
  when a test is tagged with a flow that does not declare the directory the test lives in.
  Two ways out, and picking the right one matters: if the flow is correct, add the directory to
  `surfaces` in `flows.json`; if the directory looks foreign, the *tag* is usually what's wrong.
  Quote surfaces at workspace-root depth — `packages/schemas`, `python/libs/schemas` — which is
  what the error message suggests verbatim.
- After adding or changing a flow, run `pnpm traceability:report`.
