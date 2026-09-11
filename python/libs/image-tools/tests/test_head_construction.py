"""The head-construction tool on the pose fixtures: reliability, anchors, no-face, corrections.

**This pins behaviour on real detections; it does not validate accuracy.** What it asserts hard
is that the derived reliability responds to the conditions it claims to measure — a turned head,
a small face, an anchor on the far side — and to nothing else, and that the portrait gate's "no
face" comes back as an answer with its reason.

**One landmarker serves the whole module**, so a run sends Google one usage report rather than
one per photograph (#43). One test deliberately calls without one, to cover the product path,
and sends one more.

Provenance and licence for every photograph: `docs/media-assets.md`.
"""

from collections.abc import Iterator
from pathlib import Path

import cv2
import mediapipe
import numpy as np
import pytest
from mediapipe.tasks.python.vision import FaceLandmarker

from artloupe.image_tools import (
    DetectedFace,
    FaceDetectionParameters,
    HeadConstructionResult,
    NormalizedPoint,
    construct_from_face,
    construct_head,
    find_face,
    open_landmarker,
)
from artloupe.image_tools.head import LIMITATION_DERIVED, LIMITATION_NO_FACE

pytestmark = pytest.mark.trace(flow="analysis.geometry", category="functionality")

FIXTURES = Path(__file__).resolve().parents[4] / "fixtures"
POSES = FIXTURES / "face-poses"
FRONTAL = POSES / "pexels-geezy-photography-325144321-13767162.jpg"
TILTED = POSES / "pexels-minan1398-1070745.jpg"
CHIN_UP = POSES / "pexels-anh-nguyen-517648218-20867428.jpg"
TURNED_LEFT = POSES / "pexels-roma-durkin-125803188-10963932.jpg"
TURNED_RIGHT = POSES / "pexels-cottonbro-9892782.jpg"
NEAR_PROFILE = POSES / "pexels-ba-tik-3754266.jpg"
PROFILE = POSES / "pexels-anderson-santos-883070-14086522.jpg"
FULL_LENGTH = POSES / "pexels-reneterp-325685.jpg"
PORTRAIT = FIXTURES / "demo-images" / "pexels-tim-diercks-719708976-31589335.jpg"
FACES = [FRONTAL, TILTED, CHIN_UP, TURNED_LEFT, TURNED_RIGHT, NEAR_PROFILE, PORTRAIT]

CHECKSUM = "0123456789abcdef" * 4

# The full-length photograph's face, read off it by eye: centred near (790, 670) px, about
# 175 px from the top of the head to the chin.
FULL_LENGTH_FACE_CENTRE = (790, 670)
FULL_LENGTH_FACE_PX = 175


@pytest.fixture(scope="module")
def landmarker() -> Iterator[FaceLandmarker]:
    with open_landmarker(FaceDetectionParameters()) as shared:
        yield shared


def _image(path: Path) -> np.ndarray:
    # `imread` applies EXIF orientation, which the tool requires of its caller.
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    assert isinstance(image, np.ndarray), f"could not decode {path}"
    return image


def _head(path: Path, landmarker: FaceLandmarker) -> HeadConstructionResult:
    return construct_head(_image(path), source_checksum=CHECKSUM, landmarker=landmarker)


def _face(path: Path, landmarker: FaceLandmarker) -> DetectedFace:
    face = _head(path, landmarker).face
    assert face is not None, f"no face found in {path.name}"
    return face


def _anchor(face: DetectedFace, name: str):
    (anchor,) = [item for item in face.anchors if item.name == name]
    return anchor


def _crop_around_full_length_face(target: float) -> np.ndarray:
    """A crop of the full-length photograph in which the face is `target` of the height."""
    image = _image(FULL_LENGTH)
    height, width = image.shape[:2]
    crop_height = min(height, round(FULL_LENGTH_FACE_PX / target))
    crop_width = min(width, round(crop_height * 2 / 3))
    centre_x, centre_y = FULL_LENGTH_FACE_CENTRE
    top = min(max(0, centre_y - crop_height // 2), height - crop_height)
    left = min(max(0, centre_x - crop_width // 2), width - crop_width)
    return np.ascontiguousarray(image[top : top + crop_height, left : left + crop_width])


# --- Reliability ------------------------------------------------------------------------------


def test_a_frontal_close_up_is_fully_reliable(landmarker: FaceLandmarker) -> None:
    reliability = _face(FRONTAL, landmarker).facial_landmark_reliability

    assert reliability.value >= 0.95
    assert reliability.scale == 1.0


def test_a_near_profile_scores_zero_and_names_the_yaw(landmarker: FaceLandmarker) -> None:
    reliability = _face(NEAR_PROFILE, landmarker).facial_landmark_reliability

    assert abs(reliability.yaw_deg) > 45.0
    assert reliability.value == 0.0
    assert reliability.weakest == "yaw"


def test_the_artifact_confidence_is_the_derived_reliability(landmarker: FaceLandmarker) -> None:
    result = _head(TURNED_RIGHT, landmarker)

    assert result.face is not None
    assert result.metadata.tool == "head_construction"
    assert result.metadata.confidence == result.face.facial_landmark_reliability.value
    assert LIMITATION_DERIVED in result.metadata.limitations


def test_a_small_image_of_a_face_loses_scale_reliability(landmarker: FaceLandmarker) -> None:
    """The scale signal counts source pixels, so the same face downscaled reads as smaller."""
    image = _image(FRONTAL)
    small = cv2.resize(image, (110, 138), interpolation=cv2.INTER_AREA)
    face = find_face(small, landmarker=landmarker)

    assert face is not None
    reliability = face.facial_landmark_reliability
    assert 0.0 < reliability.scale < 1.0
    assert reliability.weakest == "scale"


# --- Anchors ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "far", "near"),
    [
        (TURNED_RIGHT, "left_side", "right_side"),
        (TURNED_LEFT, "right_side", "left_side"),
    ],
)
def test_the_far_side_anchor_of_a_turned_head_is_flagged(
    path: Path, far: str, near: str, landmarker: FaceLandmarker
) -> None:
    face = _face(path, landmarker)

    assert _anchor(face, far).facing_deg > 120.0
    assert _anchor(face, far).reliability == 0.0
    assert _anchor(face, near).facing == 1.0


@pytest.mark.parametrize("path", FACES, ids=lambda path: path.stem.rsplit("-", 1)[-1])
def test_a_chin_facing_the_camera_is_never_flagged(path: Path, landmarker: FaceLandmarker) -> None:
    """A chin's surface already sits near 90° on a frontal face; it must not count against it."""
    assert _anchor(_face(path, landmarker), "chin").facing == 1.0


# --- Pose -------------------------------------------------------------------------------------


def test_pose_signs_follow_the_documented_convention(landmarker: FaceLandmarker) -> None:
    assert _face(NEAR_PROFILE, landmarker).pose.yaw_deg > 0  # toward the image's right
    assert _face(TURNED_LEFT, landmarker).pose.yaw_deg < 0
    assert _face(CHIN_UP, landmarker).pose.pitch_deg < 0  # chin raised
    assert _face(TILTED, landmarker).pose.roll_deg > 20  # toward the sitter's right shoulder


# --- No face ----------------------------------------------------------------------------------


@pytest.mark.parametrize("path", [PROFILE, FULL_LENGTH], ids=["profile", "full-length"])
def test_no_face_is_the_portrait_gates_answer(path: Path, landmarker: FaceLandmarker) -> None:
    result = _head(path, landmarker)

    assert result.face is None
    assert result.construction is None
    # Zero confidence in any construction — not `None`, which would mean "does not apply".
    assert result.metadata.confidence == 0.0
    assert LIMITATION_NO_FACE in result.metadata.limitations


def test_the_detector_has_a_small_face_limit(landmarker: FaceLandmarker) -> None:
    """Measured 2026-09-11 (#45): no face at a fifth of the frame's height, found at a quarter."""
    assert find_face(_crop_around_full_length_face(0.20), landmarker=landmarker) is None
    assert find_face(_crop_around_full_length_face(0.25), landmarker=landmarker) is not None


# --- Construction and correction ---------------------------------------------------------------


def test_a_corrected_chin_moves_the_chin_line(landmarker: FaceLandmarker) -> None:
    image = _image(FRONTAL)
    height, width = image.shape[:2]
    face = _face(FRONTAL, landmarker)
    chin = _anchor(face, "chin").point
    before = construct_from_face(face, width=width, height=height)
    after = construct_from_face(
        face,
        width=width,
        height=height,
        corrections={"chin": NormalizedPoint(x=chin.x, y=chin.y + 0.02)},
    )

    def chin_line_y(construction) -> float:
        (line,) = [item for item in construction.elements if item.name == "chin_line"]
        return float(np.mean([point.y for point in line.points]))

    assert chin_line_y(after) - chin_line_y(before) == pytest.approx(0.02, abs=0.002)
    assert after.nose_to_chin_px > before.nose_to_chin_px


def test_a_correction_to_something_that_is_not_an_anchor_is_refused(
    landmarker: FaceLandmarker,
) -> None:
    face = _face(FRONTAL, landmarker)

    with pytest.raises(ValueError, match="not an anchor"):
        construct_from_face(
            face, width=100, height=100, corrections={"ear": NormalizedPoint(x=0.1, y=0.1)}
        )


# --- The recipe -------------------------------------------------------------------------------


@pytest.mark.parametrize("path", [TURNED_RIGHT, PROFILE], ids=["face", "no-face"])
def test_a_result_reloads_from_json_exactly(path: Path, landmarker: FaceLandmarker) -> None:
    """A stored result is reloaded, never recomputed — so it has to read back as it was."""
    result = _head(path, landmarker)

    assert HeadConstructionResult.model_validate_json(result.model_dump_json()) == result


def test_the_version_names_the_runtime_and_the_model(landmarker: FaceLandmarker) -> None:
    version = _head(FRONTAL, landmarker).metadata.tool_version

    assert f"mediapipe-{mediapipe.__version__}" in version
    assert ".face_landmarker-" in version


def test_without_a_landmarker_one_is_opened_for_the_call() -> None:
    """The product path: a landmarker per call. This test sends one usage report of its own."""
    result = construct_head(_image(FRONTAL), source_checksum=CHECKSUM)

    assert result.face is not None
