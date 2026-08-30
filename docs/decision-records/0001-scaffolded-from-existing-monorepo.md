# 0001 — Scaffold Art Loupe from an existing monorepo rather than greenfield

- **Status:** Accepted
- **Date:** 2026-08-20
- **Deciders:** Laurie Reynolds

## Context

Art Loupe is a multi-agent capstone project needing, on day one, a working
authentication flow, a shared component library, i18n, accessibility linting, test
traceability, CI, and a Python agent workspace. None of that is the interesting part of
the project, and all of it already existed — built and hardened — in a prior capstone
monorepo of the same shape (Next.js apps + shared TS packages + a uv Python workspace +
a local Supabase stack).

The alternative was a greenfield `create-next-app` and rebuilding each piece as it became
necessary.

## Decision

Seed the repository by copying the prior monorepo and **stripping it to scaffolding**:
keep the infrastructure, delete the domain.

Kept: the toolchain (Biome, ESLint + jsx-a11y, Stylelint, markdownlint, Vitest,
Playwright, dependency-cruiser, commitlint, husky), the report generators under
`scripts/reports/`, the CI workflows, `packages/auth` and its `AuthProvider` seam,
`packages/fascia`, the acknowledgement-gate mechanism, and the test-traceability system.

Removed: every clinical domain surface — one whole app, all Python agent and MCP code,
six of seven database migrations, the shared clinical schemas, and the domain
documentation.

Renamed: package scope to `@artloupe/*`, the artist-facing app to `apps/studio`, the session
role union to `artist | operator | superuser`, and all cookies, env vars, and origins.

Git history was reset; the repository starts from a single scaffold commit.

## Rationale

The infrastructure represented substantial prior work whose value is entirely
domain-independent. Rebuilding it would have consumed the project's early capacity
without producing anything a reviewer would credit as art-application work.

Stripping rather than selectively copying was the safer direction: it is far easier to
notice that something needed is missing (a build fails, a test fails) than to notice that
something unneeded was carried along. Four intact copies of the source repository exist
locally, so any deletion is one `git checkout` away from being reversed.

## Alternatives considered

- **Greenfield.** Cleanest history and no inherited assumptions, but re-solves auth,
  a11y tooling, i18n parity checking, traceability, and CI from zero.
- **Fork with history.** Keeps the safety net inline, but carries 137 commits of an
  unrelated clinical product into the project's record, and leaves the original remote
  attached — where a stray push would land in the wrong repository.
- **Copy pieces forward on demand.** Lowest initial footprint, but the pieces are
  interdependent (fascia ← auth ← the app shells ← the gate chain), so the copying never
  actually stays small.

## Consequences

- The repository's idioms, comment style, and rule files are inherited. They are good,
  but they were written for a different domain and will need re-reading as the art
  domain firms up rather than being treated as settled.
- `packages/schemas` and the `python/` workspace are **empty scaffolds**. Their test
  scripts pass with no tests (`--passWithNoTests`); this must be revisited when real
  code lands, or an empty suite will silently look green.
- The traceability catalog was rewritten with art flows drafted ahead of the features
  they describe. Eight flows currently have no test. They are a plan, not a record, and
  should be corrected as the real shape emerges rather than treated as a specification.
- Reference material for the art domain lives outside the repository and is untrusted
  source material — planning transcripts and competitor output samples, not authored
  specifications.

## Related

- `docs/decision-records/settled-decisions.md`
