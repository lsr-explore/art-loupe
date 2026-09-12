"""The head-construction tool: FR-302's overlay, from one photograph (slice 1 PR 10).

Finds the face (`faces.py`), fits the Loomis construction to its anchors (`loomis.py`), and
records FR-305 metadata. The artifact's confidence is `facial_landmark_reliability` — derived,
and its limitations say so (`geometry-confidence-plan.md` §3) — and every anchor carries its own.

**No face is an answer, not an error.** It is the portrait gate's decision (FR-307): a head turned
past what the detector handles, or a face too small for it (#45), both come back as no face, with
the reason stated.

Nothing here produces imagery (FR-801): the result is landmarks, measurements and geometry.
"""

import hashlib
import time
from collections.abc import Mapping
from functools import cache

import mediapipe
import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, model_validator

from artloupe.image_tools.faces import (
    ANCHOR_LANDMARKS,
    MODEL_PATH,
    AnchorName,
    DetectedFace,
    FaceDetectionParameters,
    OpenLandmarker,
    find_face,
)
from artloupe.image_tools.loomis import ConstructionParameters, LoomisConstruction, construct
from artloupe.image_tools.perspective import NormalizedPoint
from artloupe.image_tools.versioning import tool_version
from artloupe.schemas.artifact import ArtifactMetadata
from artloupe.schemas.evidence import Checksum

# Bump when the algorithm or any constant in `faces.py` or `loomis.py` changes what an input
# produces. The runtime and the bundled model both move the landmarks, so both join the version.
HEAD_ALGORITHM_VERSION = "2"

# The outer eye corners: the eye line's only inputs, measured and not draggable.
_EYE_CORNERS = (33, 263)

LIMITATION_DERIVED = (
    "facial_landmark_reliability is derived from the head's pose, the face's size in source "
    "pixels and each anchor's facing — conditions the observation was made under — and is not "
    "a score the detector reports. The detector reports none."
)
LIMITATION_CHOSEN_SCAFFOLD = (
    "The cranial ball and side planes are chosen, drawn from the measured brow-to-nose distance "
    "by a labelled factor. They are not measured on the photograph."
)
LIMITATION_RATIOS_ONLY = (
    "The brow-to-nose and nose-to-chin distances are measurements only. Nothing is scored "
    "against the method's ideal proportions, and a face departing from them is not an error."
)
LIMITATION_ORTHOGRAPHIC = (
    "The construction is projected orthographically: it assumes the head is far from the lens "
    "relative to its own depth, which a close, wide-angle photograph breaks."
)
LIMITATION_ONE_FACE = "Only the most prominent face is analysed."
LIMITATION_NOT_VALIDATED = (
    "Landmarks are not validated against a gold set; the reliability measures the conditions of "
    "the observation, not whether each landmark is where the artist would put it."
)
LIMITATION_NO_FACE = (
    "No face was found. The bundled detector finds no head turned much past a three-quarter "
    "view, and no face whose landmarks would span less than about 15–18% of the frame's height; "
    "either comes back as no face."
)
LIMITATION_FRAMING = (
    "Head pose is corrected for where the face sits in the frame, with a field of view "
    "calibrated on the pose fixtures; about a third of the framing effect remains, and a "
    "genuinely wide-angle photograph keeps its real perspective."
)


class HeadConstructionParameters(BaseModel):
    """What the tool runs with. Recorded verbatim, after validation, in the FR-305 metadata."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    detection: FaceDetectionParameters = Field(default_factory=FaceDetectionParameters)
    construction: ConstructionParameters = Field(default_factory=ConstructionParameters)


class HeadConstructionResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    # `None` when no face was found — the portrait gate's "not a portrait".
    face: DetectedFace | None
    construction: LoomisConstruction | None
    metadata: ArtifactMetadata

    @model_validator(mode="after")
    def _face_and_construction_together(self) -> "HeadConstructionResult":
        if (self.face is None) != (self.construction is None):
            raise ValueError("a construction exists exactly when a face was found")
        return self


@cache
def _model_digest() -> str:
    return hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()[:12]


def _tool_version() -> str:
    return tool_version(
        HEAD_ALGORITHM_VERSION,
        f"mediapipe-{mediapipe.__version__}",
        f"face_landmarker-{_model_digest()}",
    )


def construct_from_face(
    face: DetectedFace,
    *,
    width: int,
    height: int,
    parameters: ConstructionParameters | None = None,
    corrections: Mapping[AnchorName, NormalizedPoint] | None = None,
) -> LoomisConstruction:
    """The construction for `face`, with any artist-corrected anchors in place (FR-403/404).

    A correction moves an anchor within the picture, in the overlay's normalized space; its depth
    is kept from the detector, since the artist corrects what they can see. `width` and `height`
    are the source image's, as for the detection.
    """
    corrected = dict(corrections or {})
    unknown = sorted(set(corrected) - set(ANCHOR_LANDMARKS))
    if unknown:
        raise ValueError(f"not an anchor: {', '.join(unknown)}")

    anchors_px: dict[AnchorName, NDArray[np.float64]] = {}
    for anchor in face.anchors:
        where = corrected.get(anchor.name)
        x = where.x if where is not None else anchor.point.x
        y = where.y if where is not None else anchor.point.y
        anchors_px[anchor.name] = np.array([x * width, y * height, anchor.point.z * width])
    right_eye, left_eye = (
        np.array([mark.x * width, mark.y * height, mark.z * width])
        for mark in (face.landmarks[index] for index in _EYE_CORNERS)
    )
    return construct(
        anchors_px, (right_eye, left_eye), width=width, height=height, parameters=parameters
    )


def construct_head(
    image: NDArray[np.uint8],
    *,
    source_checksum: Checksum,
    parameters: HeadConstructionParameters | None = None,
    landmarker: OpenLandmarker | None = None,
) -> HeadConstructionResult:
    """Find the face, fit the construction, and state what it rests on.

    `image` is a uint8 grayscale or BGR array, EXIF-oriented, at full resolution. A shared
    `landmarker` runs, and is recorded, with the parameters it was opened with; passing different
    detection parameters as well is refused. Without one, a landmarker is created and closed for
    this call, which sends Google one usage report (#43).
    """
    started = time.perf_counter()
    params = parameters or HeadConstructionParameters()
    if landmarker is not None:
        if parameters is not None and parameters.detection != landmarker.parameters:
            raise ValueError("the landmarker was opened with different detection parameters")
        params = params.model_copy(update={"detection": landmarker.parameters})
    face = find_face(image, parameters=params.detection, landmarker=landmarker)

    def metadata(confidence: float, limitations: list[str]) -> ArtifactMetadata:
        return ArtifactMetadata(
            tool="head_construction",
            tool_version=_tool_version(),
            parameters=params.model_dump(),
            source_checksum=source_checksum,
            duration_ms=round((time.perf_counter() - started) * 1000),
            confidence=confidence,
            limitations=limitations,
        )

    if face is None:
        # Finding no face is a claim of zero confidence in any construction — not `None`, which
        # would say the notion does not apply to this tool.
        return HeadConstructionResult(
            face=None,
            construction=None,
            metadata=metadata(0.0, [LIMITATION_NO_FACE, LIMITATION_ONE_FACE]),
        )

    height, width = image.shape[:2]
    construction = construct_from_face(
        face, width=width, height=height, parameters=params.construction
    )
    return HeadConstructionResult(
        face=face,
        construction=construction,
        metadata=metadata(
            face.facial_landmark_reliability.value,
            [
                LIMITATION_DERIVED,
                LIMITATION_FRAMING,
                LIMITATION_CHOSEN_SCAFFOLD,
                LIMITATION_RATIOS_ONLY,
                LIMITATION_ORTHOGRAPHIC,
                LIMITATION_ONE_FACE,
                LIMITATION_NOT_VALIDATED,
            ],
        ),
    )
