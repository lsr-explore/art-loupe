"""Deterministic image tools for Art Loupe.

Each tool reads a photograph the artist supplied and returns geometry or measurement plus
FR-305 metadata. None returns imagery (FR-801). Slice 1 PR 11 adds the first: perspective.
"""

from artloupe.image_tools.perspective import (
    FULL_SIGNIFICANCE_MULTIPLE,
    FULL_SUPPORT_SEGMENTS,
    MAX_VANISHING_DISTANCE,
    MAX_VANISHING_POINTS,
    Horizon,
    NormalizedPoint,
    PerspectiveParameters,
    PerspectiveResult,
    VanishingPoint,
    VanishingPointConfidence,
    detect_perspective,
)

__all__ = [
    "FULL_SIGNIFICANCE_MULTIPLE",
    "FULL_SUPPORT_SEGMENTS",
    "MAX_VANISHING_DISTANCE",
    "MAX_VANISHING_POINTS",
    "Horizon",
    "NormalizedPoint",
    "PerspectiveParameters",
    "PerspectiveResult",
    "VanishingPoint",
    "VanishingPointConfidence",
    "detect_perspective",
]
