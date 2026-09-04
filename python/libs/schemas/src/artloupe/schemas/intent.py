"""What the artist told us they are trying to do (FR-102, FR-104).

Medium and time are required because both change tool selection; everything else has a
default, so intake stays one short form rather than an interview. The Studio Director may
ask at most one clarifying question on top of this, and only when the answer changes the
manifest (FR-103) — asking zero is the normal case.

`goal` is free text the artist wrote. It is **untrusted input** on the same footing as EXIF
and filename (FR-106): screened at ingest, never interpreted as instruction.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# The media a plan can be built for.
#
# Scoped deliberately: pastel, gouache, and digital are **not** supported in the first
# version, so they are absent rather than accepted-and-handled-badly. Every entry here is a
# medium the planner is expected to produce a defensible plan for.
#
# Spelling follows the repo's existing convention — `watercolour`, `coloured-pencil`, to
# match `licence` and "eight-colour palette" in the design documents. These are wire values,
# so a mixed convention would be a lasting papercut.
#
# Kept as one editable literal on each side: widening it is a two-line diff, and it is the
# kind of call that belongs to whoever owns the art domain.
Medium = Literal[
    "graphite",
    "charcoal",
    "ink",
    "coloured-pencil",
    "watercolour",
    "acrylic",
    "oil",
]

MEDIA: tuple[str, ...] = (
    "graphite",
    "charcoal",
    "ink",
    "coloured-pencil",
    "watercolour",
    "acrylic",
    "oil",
)

SkillLevel = Literal["beginner", "intermediate", "advanced"]

SKILL_LEVELS: tuple[str, ...] = ("beginner", "intermediate", "advanced")


class SupportSize(BaseModel):
    """Physical size of what the artist is working on.

    Real-world units are correct *here* and nowhere near a measurement. FR-306 forbids
    inferring real-world units from an uncalibrated photograph; this is the artist stating
    the size of a thing they are holding, which is a different act. Do not "fix" this to
    match `Measured.units`.
    """

    model_config = ConfigDict(extra="forbid")

    width: float = Field(gt=0)
    height: float = Field(gt=0)
    units: Literal["mm", "in"]


class ProjectIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    medium: Medium
    time_budget_minutes: int = Field(gt=0)
    support: SupportSize | None = None
    skill_level: SkillLevel = "intermediate"
    # Untrusted artist text (FR-106). Screened at ingest, never instruction.
    goal: str | None = Field(default=None, max_length=2000)
