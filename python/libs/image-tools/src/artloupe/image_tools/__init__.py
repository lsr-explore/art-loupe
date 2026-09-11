"""Deterministic image tools for Art Loupe.

Each tool reads a photograph the artist supplied and returns geometry, measurement or a plate,
plus FR-305 metadata. None generates imagery (FR-801): every pixel of a plate is a fixed
function of the artist's own photograph and the recorded parameters, reproducible from its
recipe, and nothing in it is invented. Slice 1 has two tools: perspective (PR 11) and the plate
suite (PR 8).
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
from artloupe.image_tools.plates import (
    DETAIL_LEVELS,
    HARD_EDGE_GRADIENT,
    SOFT_EDGE_GRADIENT,
    GrayscalePlate,
    OutlineDetail,
    OutlinePlate,
    PlateParameters,
    PlateSuite,
    ValueContour,
    ValuePlate,
    make_plates,
)

__all__ = [
    "DETAIL_LEVELS",
    "FULL_SIGNIFICANCE_MULTIPLE",
    "FULL_SUPPORT_SEGMENTS",
    "HARD_EDGE_GRADIENT",
    "MAX_VANISHING_DISTANCE",
    "MAX_VANISHING_POINTS",
    "SOFT_EDGE_GRADIENT",
    "GrayscalePlate",
    "Horizon",
    "NormalizedPoint",
    "OutlineDetail",
    "OutlinePlate",
    "PerspectiveParameters",
    "PerspectiveResult",
    "PlateParameters",
    "PlateSuite",
    "ValueContour",
    "ValuePlate",
    "VanishingPoint",
    "VanishingPointConfidence",
    "detect_perspective",
    "make_plates",
]
