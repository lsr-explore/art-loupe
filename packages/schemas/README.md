# @artloupe/schemas

Shared TypeScript contracts — Zod schemas and inferred types for the boundary between
the apps and the Python agent layer.

**Currently an empty scaffold.** The clinical schemas this package inherited were
removed when the repository was scaffolded; the art contracts are authored alongside
the first agent workflow.

## Why Zod rather than plain types

The agent response crosses a process boundary, so a plain `interface` is a claim, not a
check. `.parse()` at the seam is the anti-confabulation guarantee: never render a
decision that has not been validated.

```ts
import { critiqueSchema, type Critique } from '@artloupe/schemas';

const critique: Critique = critiqueSchema.parse(payload);
```

## Planned direction

Codegen from the Python Pydantic models, with the output **committed** and a CI
drift-check (`git diff --exit-code`). Hand-authored only as the bridge until codegen
lands.

Field names match the wire format faithfully — the mirror does not "fix" casing the
Python side emits, because a mirror that silently renames fields is not a mirror.
