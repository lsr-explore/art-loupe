"""Shared Pydantic contracts for Art Loupe.

The Python half of the boundary between the apps and the agent layer, mirrored field for
field by `packages/schemas` (Zod). Validation at the seam is the anti-confabulation
guarantee: never act on a payload that has not been validated.

The mirror is hand-authored and kept honest by
`packages/schemas/fixtures/contract-parity.json`, which both this package's suite and the
TypeScript suite validate. Codegen from these models, with committed output and a CI drift
check, remains the planned follow-up — at which point the fixture becomes the codegen's own
conformance suite rather than going away.
"""

from artloupe.schemas.artifact import ArtifactMetadata
from artloupe.schemas.budget import BudgetLedger
from artloupe.schemas.evidence import (
    MEASUREMENT_UNITS,
    Checksum,
    Chosen,
    Cited,
    Claim,
    Evidence,
    Measured,
    MeasurementUnit,
    PassageSpan,
)
from artloupe.schemas.image import (
    ACCEPTED_MIME_TYPES,
    MAX_UPLOAD_BYTES,
    MIN_LONG_EDGE_PX,
    AcceptedMimeType,
    ImageRef,
)
from artloupe.schemas.intent import (
    MEDIA,
    SKILL_LEVELS,
    Medium,
    ProjectIntent,
    SkillLevel,
    SupportSize,
)
from artloupe.schemas.manifest import (
    TOOLS,
    ToolDeclination,
    ToolManifest,
    ToolName,
    ToolSelection,
)

__all__ = [
    "ACCEPTED_MIME_TYPES",
    "MAX_UPLOAD_BYTES",
    "MEASUREMENT_UNITS",
    "MEDIA",
    "MIN_LONG_EDGE_PX",
    "SKILL_LEVELS",
    "TOOLS",
    "AcceptedMimeType",
    "ArtifactMetadata",
    "BudgetLedger",
    "Checksum",
    "Chosen",
    "Cited",
    "Claim",
    "Evidence",
    "ImageRef",
    "Measured",
    "MeasurementUnit",
    "Medium",
    "PassageSpan",
    "ProjectIntent",
    "SkillLevel",
    "SupportSize",
    "ToolDeclination",
    "ToolManifest",
    "ToolName",
    "ToolSelection",
]
