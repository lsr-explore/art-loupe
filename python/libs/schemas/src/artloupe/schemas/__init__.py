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
    IncompleteManifest,
    ToolDeclination,
    ToolManifest,
    ToolName,
    ToolSelection,
    check_accounts_for,
)
from artloupe.schemas.plan import (
    DEFECT_CATEGORIES,
    EVIDENCE_DEFECTS,
    LESSON_TOPICS,
    MATERIAL_CATEGORIES,
    SUITABILITIES,
    VERDICTS,
    CitedLesson,
    CriticVerdict,
    DefectCategory,
    Finding,
    LessonTopic,
    MaterialCategory,
    MaterialItem,
    PlanClaim,
    PlanDefect,
    PlanOutcome,
    PlanStage,
    ProjectPlan,
    ReferenceAssessment,
    SetAside,
    Suitability,
    Verdict,
    VisualFindings,
)
from artloupe.schemas.routing import RoutingDecision, RoutingGate
from artloupe.schemas.run import RUN_FAILURE_REASONS, RunFailure, RunFailureReason, RunResult
from artloupe.schemas.screening import (
    EXCERPT_MAX_LENGTH,
    SCREENED_SURFACES,
    Detection,
    DetectionSeverity,
    ScreenedSurface,
    screen_text,
    screen_values,
)

__all__ = [
    "ACCEPTED_MIME_TYPES",
    "DEFECT_CATEGORIES",
    "EVIDENCE_DEFECTS",
    "EXCERPT_MAX_LENGTH",
    "LESSON_TOPICS",
    "MATERIAL_CATEGORIES",
    "MAX_UPLOAD_BYTES",
    "MEASUREMENT_UNITS",
    "MEDIA",
    "MIN_LONG_EDGE_PX",
    "RUN_FAILURE_REASONS",
    "SCREENED_SURFACES",
    "SKILL_LEVELS",
    "SUITABILITIES",
    "TOOLS",
    "VERDICTS",
    "AcceptedMimeType",
    "ArtifactMetadata",
    "BudgetLedger",
    "Checksum",
    "Chosen",
    "Cited",
    "CitedLesson",
    "Claim",
    "CriticVerdict",
    "DefectCategory",
    "Detection",
    "DetectionSeverity",
    "Evidence",
    "Finding",
    "ImageRef",
    "IncompleteManifest",
    "LessonTopic",
    "MaterialCategory",
    "MaterialItem",
    "Measured",
    "MeasurementUnit",
    "Medium",
    "PassageSpan",
    "PlanClaim",
    "PlanDefect",
    "PlanOutcome",
    "PlanStage",
    "ProjectIntent",
    "ProjectPlan",
    "ReferenceAssessment",
    "RoutingDecision",
    "RoutingGate",
    "RunFailure",
    "RunFailureReason",
    "RunResult",
    "ScreenedSurface",
    "SetAside",
    "SkillLevel",
    "Suitability",
    "SupportSize",
    "ToolDeclination",
    "ToolManifest",
    "ToolName",
    "ToolSelection",
    "Verdict",
    "VisualFindings",
    "check_accounts_for",
    "screen_text",
    "screen_values",
]
