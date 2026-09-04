# artloupe-schemas

Shared Pydantic contracts — the Python side of the boundary between the apps and the agent
layer.

A library, not a service. Every Python service imports these models and validates at its own
seam, because a payload that crossed a process boundary unvalidated is a claim rather than a
fact.

```python
from artloupe.schemas import ImageRef

reference = ImageRef.model_validate(payload)
```

## What is here

| Contract | Requirement | Note |
| --- | --- | --- |
| `Claim` and the `Measured \| Cited \| Chosen` union | §6, FR-603 | Discriminated on `kind`. Closed — an unclassified claim fails validation. |
| `ImageRef` | FR-101, FR-105 | A reference, never bytes. Everything downstream keys on `checksum`. |
| `ProjectIntent` | FR-102, FR-104 | Medium and time required; the rest defaulted. |
| `ToolManifest` | FR-307 | `reason` is required on a declination — a silent decline reads as a bug. |
| `ArtifactMetadata` | FR-305 | Agents cite this; they never describe an artifact from memory. |
| `BudgetLedger` | NFR-04 | Token ceiling plus hard stop. |

Every model sets `extra="forbid"`. A tolerated unknown field is how a renamed contract keeps
passing tests on one side while silently losing data on the other.

Two invariants are structural rather than prompted:

- **`Measured.units` has no real-world unit.** That is what makes FR-306 enforceable — there
  is no field to put millimetres in. `SupportSize` does carry mm and inches, and that is
  correct: the artist stating the size of their paper is not a measurement taken from an
  uncalibrated photograph.
- **`confidence` has no default.** `None` (the notion does not apply — a grayscale conversion
  either ran or it did not) and `0.0` (measured, and very low) are different claims. A tool
  that omits it fails validation rather than reporting `None`.

## Parity with TypeScript

The Zod mirror lives at `packages/schemas`. Neither side owns the contract:
`packages/schemas/fixtures/contract-parity.json` is a shared conformance fixture that
**both** suites load and assert against, including a `rejects` block that pins every
validator.

`tests/test_parity.py` locates that fixture by walking up to the workspace root rather than
by a relative-depth constant, so moving this package produces a real error instead of a
missing-file mystery.

Codegen from these models — committed output plus a CI drift check — remains the planned
follow-up, at which point the fixture becomes the codegen's conformance suite.
