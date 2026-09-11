"""Deterministic image tools for Art Loupe.

Each tool reads a photograph the artist supplied and returns geometry, measurement or a plate,
plus FR-305 metadata. None generates imagery (FR-801): every pixel of a plate is a fixed
function of the artist's own photograph and the recorded parameters, reproducible from its
recipe, and nothing in it is invented. Slice 1 has three tools: perspective (PR 11), the plate
suite (PR 8), and head construction (PR 10).
"""

from artloupe.image_tools.faces import (
    ANCHOR_LANDMARKS,
    Anchor,
    AnchorName,
    DetectedFace,
    FaceDetectionParameters,
    FacialLandmarkReliability,
    HeadPose,
    Landmark,
    find_face,
    open_landmarker,
)
from artloupe.image_tools.head import (
    HeadConstructionParameters,
    HeadConstructionResult,
    construct_from_face,
    construct_head,
)
from artloupe.image_tools.loomis import (
    ConstructionElement,
    ConstructionParameters,
    LoomisConstruction,
)
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
    "ANCHOR_LANDMARKS",
    "DETAIL_LEVELS",
    "FULL_SIGNIFICANCE_MULTIPLE",
    "FULL_SUPPORT_SEGMENTS",
    "HARD_EDGE_GRADIENT",
    "MAX_VANISHING_DISTANCE",
    "MAX_VANISHING_POINTS",
    "SOFT_EDGE_GRADIENT",
    "Anchor",
    "AnchorName",
    "ConstructionElement",
    "ConstructionParameters",
    "DetectedFace",
    "FaceDetectionParameters",
    "FacialLandmarkReliability",
    "GrayscalePlate",
    "HeadConstructionParameters",
    "HeadConstructionResult",
    "HeadPose",
    "Horizon",
    "Landmark",
    "LoomisConstruction",
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
    "construct_from_face",
    "construct_head",
    "detect_perspective",
    "find_face",
    "make_plates",
    "open_landmarker",
]
