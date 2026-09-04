"""The evidence taxonomy, as a closed type.

`docs/design/requirements.md` §6 is normative: every assertion an agent emits carries
exactly one of three classes. The union being *closed* is the point — an unclassified claim
is a schema failure at the seam, before it can ever become a Plan Critic finding (FR-603,
FR-702 `unclassified_claim`).

Two invariants are structural here rather than prompted:

- `Measured.units` admits only pixel and normalised units, so FR-306 ("real-world units are
  never inferred from an uncalibrated photograph") has no field to be violated in.
- An artist assertion is never evidence (FR-1013). "The light comes from the left" may be
  adopted, but only as a `chosen` claim naming the artist as its reason — there is no path
  that promotes it to `measured` or `cited`.

Mirrored field-for-field by `packages/schemas/src/evidence.ts`; the shared fixture at
`packages/schemas/fixtures/contract-parity.json` is what keeps the two honest.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# SHA-256 of the immutable source upload (FR-105), lowercase hex.
Checksum = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]

# Units a measurement may be reported in.
#
# Deliberately excludes every real-world unit. Adding "mm" here would silently retire
# FR-306, so this type is the enforcement point — not a prompt instruction.
MeasurementUnit = Literal["px", "normalized"]

MEASUREMENT_UNITS: tuple[str, ...] = ("px", "normalized")


class Measured(BaseModel):
    """A fact computed by a deterministic tool."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["measured"] = "measured"
    tool: str = Field(min_length=1)
    tool_version: str = Field(min_length=1)
    # The validated parameters the tool actually ran with, not the ones it was asked for.
    parameters: dict[str, Any]
    source_checksum: Checksum
    units: MeasurementUnit


class Cited(BaseModel):
    """A claim taken from a retrieved instructional source."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["cited"] = "cited"
    chunk_id: str = Field(min_length=1)
    institution: str = Field(min_length=1)
    url: str = Field(min_length=1)
    licence: str = Field(min_length=1)
    retrieved_at: datetime
    # Character span within the retrieved chunk that supports the claim.
    passage_span: "PassageSpan"


class PassageSpan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: int = Field(ge=0)
    end: int = Field(ge=0)


class Chosen(BaseModel):
    """An artistic call the system is making on the artist's behalf."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["chosen"] = "chosen"
    # Why this call was made. When the artist supplied it, that is what this says.
    reason: str = Field(min_length=1)
    # What was rejected. A choice with no alternative is a fact wearing a costume.
    rejected_alternative: str = Field(min_length=1)


Evidence = Annotated[Measured | Cited | Chosen, Field(discriminator="kind")]


class Claim(BaseModel):
    """The atom every agent emits. There is no untagged string in a plan."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1)
    evidence: Evidence


Cited.model_rebuild()
