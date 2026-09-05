# @artloupe/schemas

Shared TypeScript contracts — Zod schemas and inferred types for the boundary between
the apps and the Python agent layer.

## Why Zod rather than plain types

The agent response crosses a process boundary, so a plain `interface` is a claim, not a
check. `.parse()` at the seam is the anti-confabulation guarantee: never render a
decision that has not been validated.

```ts
import { imageRefSchema, type ImageRef } from '@artloupe/schemas';

const reference: ImageRef = imageRefSchema.parse(payload);
```

## What is here

| Contract | Requirement | Note |
| --- | --- | --- |
| `claimSchema` and the `measured \| cited \| chosen` union | §6, FR-603 | Closed union. An unclassified claim is a schema failure, not a critic finding. |
| `imageRefSchema` | FR-101, FR-105 | A reference, never bytes. Everything downstream keys on `checksum`. |
| `projectIntentSchema` | FR-102, FR-104 | Medium and time required; the rest defaulted. |
| `toolManifestSchema` | FR-307 | `reason` is required on a declination — a silent decline reads as a bug. |
| `artifactMetadataSchema` | FR-305 | Agents cite this; they never describe an artifact from memory. |
| `budgetLedgerSchema` | NFR-04 | Token ceiling plus hard stop. |

Two invariants are structural rather than prompted, and both are easy to break by being
helpful:

- **`Measured.units` has no real-world unit.** That is what makes FR-306 enforceable —
  there is no field to put millimetres in. `SupportSize` does carry mm and inches, and
  that is correct: the artist stating the size of their paper is not a measurement taken
  from an uncalibrated photograph.
- **`confidence` has no default.** `null` (the notion does not apply — a grayscale
  conversion either ran or it did not) and `0` (measured, and very low) are different
  claims. A tool that omits it fails validation rather than reporting `null`.

## Parity with Python

The Pydantic mirror lives at `python/libs/schemas`. Neither side owns the contract:
`fixtures/contract-parity.json` is a shared conformance fixture that **both** suites load
and assert against, including a `rejects` block that pins every refinement.

That fixture is the reason a hand-written mirror is safe enough to ship. A field added on
one side and forgotten on the other fails in the suite that did not change.

Field names match the wire format faithfully — the mirror does not "fix" casing the
Python side emits, because a mirror that silently renames fields is not a mirror.

## Planned direction

Codegen from the Python Pydantic models, with the output **committed** and a CI
drift-check (`git diff --exit-code`). Hand-authored only as the bridge until codegen
lands, at which point the parity fixture becomes the codegen's conformance suite rather
than going away.
