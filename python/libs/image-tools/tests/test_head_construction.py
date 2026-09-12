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

from artloupe.image_tools import (
    DetectedFace,
    FaceDetectionParameters,
    HeadConstructionParameters,
    HeadConstructionResult,
    NormalizedPoint,
    OpenLandmarker,
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
def landmarker() -> Iterator[OpenLandmarker]:
    with open_landmarker(FaceDetectionParameters()) as shared:
        yield shared


def _image(path: Path) -> np.ndarray:
    # `imread` applies EXIF orientation, which the tool requires of its caller.
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    assert isinstance(image, np.ndarray), f"could not decode {path}"
    return image


def _head(path: Path, landmarker: OpenLandmarker) -> HeadConstructionResult:
    return construct_head(_image(path), source_checksum=CHECKSUM, landmarker=landmarker)


def _face(path: Path, landmarker: OpenLandmarker) -> DetectedFace:
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


def test_a_frontal_close_up_is_fully_reliable(landmarker: OpenLandmarker) -> None:
    reliability = _face(FRONTAL, landmarker).facial_landmark_reliability

    assert reliability.value >= 0.95
    assert reliability.scale == 1.0


def test_a_near_profile_scores_near_zero_and_names_the_yaw(landmarker: OpenLandmarker) -> None:
    reliability = _face(NEAR_PROFILE, landmarker).facial_landmark_reliability

    assert abs(reliability.yaw_deg) > 55.0
    assert reliability.value <= 0.1
    assert reliability.weakest == "yaw"


def test_the_artifact_confidence_is_the_derived_reliability(landmarker: OpenLandmarker) -> None:
    result = _head(TURNED_RIGHT, landmarker)

    assert result.face is not None
    assert result.metadata.tool == "head_construction"
    assert result.metadata.confidence == result.face.facial_landmark_reliability.value
    assert LIMITATION_DERIVED in result.metadata.limitations


def test_a_small_image_of_a_face_loses_scale_reliability(landmarker: OpenLandmarker) -> None:
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
    path: Path, far: str, near: str, landmarker: OpenLandmarker
) -> None:
    face = _face(path, landmarker)

    assert _anchor(face, far).facing_deg > 120.0
    assert _anchor(face, far).reliability == 0.0
    assert _anchor(face, near).facing == 1.0


@pytest.mark.parametrize("path", FACES, ids=lambda path: path.stem.rsplit("-", 1)[-1])
def test_a_chin_facing_the_camera_is_never_flagged(path: Path, landmarker: OpenLandmarker) -> None:
    """A chin's surface already sits near 90° on a frontal face; it must not count against it."""
    assert _anchor(_face(path, landmarker), "chin").facing == 1.0


# --- Pose -------------------------------------------------------------------------------------


def test_pose_signs_follow_the_documented_convention(landmarker: OpenLandmarker) -> None:
    assert _face(NEAR_PROFILE, landmarker).pose.yaw_deg > 0  # toward the image's right
    assert _face(TURNED_LEFT, landmarker).pose.yaw_deg < 0
    assert _face(CHIN_UP, landmarker).pose.pitch_deg < 0  # chin raised
    assert _face(TILTED, landmarker).pose.roll_deg > 20  # toward the sitter's right shoulder


def _placed(image: np.ndarray, face: DetectedFace, where: str) -> np.ndarray:
    """A head-and-shoulders crop, padded flat on one side so the face sits high, low, left or right.

    Nothing is cut from the face and nothing invented: the flat border only moves the face
    within the frame, which cannot change the head's true pose.
    """
    height, width = image.shape[:2]
    ys = [mark.y * height for mark in face.landmarks]
    xs = [mark.x * width for mark in face.landmarks]
    crop_height = int(min(height, (max(ys) - min(ys)) / 0.4))
    crop_width = int(min(width, crop_height * 0.8))
    top = int(min(max(0, (min(ys) + max(ys)) / 2 - crop_height / 2), height - crop_height))
    left = int(min(max(0, (min(xs) + max(xs)) / 2 - crop_width / 2), width - crop_width))
    crop = np.ascontiguousarray(image[top : top + crop_height, left : left + crop_width])
    pad = int(0.6 * crop_height)
    fill = [int(channel) for channel in crop.reshape(-1, 3).mean(axis=0)]
    # The pad goes on the side opposite to where the face should end up.
    above, below, before, after = (
        pad * (where == side) for side in ("low", "high", "right", "left")
    )
    return cv2.copyMakeBorder(crop, above, below, before, after, cv2.BORDER_CONSTANT, value=fill)


@pytest.mark.parametrize(
    ("path", "placements", "angle", "remaining"),
    [
        (PORTRAIT, ("high", "low"), "pitch", 1 / 3),
        (TURNED_LEFT, ("left", "right"), "yaw", 1 / 3),
        # The detector's yaw error grows as the head turns and the correction does not, so on a
        # near-frontal face it overshoots: measured 2026-09-11, 10.9° of shift became 4.8° the
        # other way. Disclosed in the limitations, and bounded here.
        (PORTRAIT, ("left", "right"), "yaw", 0.6),
    ],
    ids=["pitch-high-and-low", "yaw-turned-left-and-right", "yaw-frontal-left-and-right"],
)
def test_pose_barely_depends_on_where_the_face_sits(
    path: Path,
    placements: tuple[str, str],
    angle: str,
    remaining: float,
    landmarker: OpenLandmarker,
) -> None:
    """The framing correction: the same face at opposite sides of the frame.

    The detector's own angle moves several degrees between the two — pitch high and low, yaw left
    and right — though the head has not moved; the corrected angle should move far less
    (calibrated 2026-09-11, `FRAMING_VFOV_DEG`). A sign error in either direction of the
    correction adds to the detector's shift instead of removing it, which every case here fails.
    """
    image = _image(path)
    face = _face(path, landmarker)
    first, second = (
        find_face(_placed(image, face, where), landmarker=landmarker) for where in placements
    )

    assert first is not None and second is not None
    detector_shift = abs(
        getattr(first.pose, f"detector_{angle}_deg") - getattr(second.pose, f"detector_{angle}_deg")
    )
    corrected_shift = abs(
        getattr(first.pose, f"{angle}_deg") - getattr(second.pose, f"{angle}_deg")
    )
    assert detector_shift > 5.0
    assert corrected_shift < detector_shift * remaining


# --- No face ----------------------------------------------------------------------------------


@pytest.mark.parametrize("path", [PROFILE, FULL_LENGTH], ids=["profile", "full-length"])
def test_no_face_is_the_portrait_gates_answer(path: Path, landmarker: OpenLandmarker) -> None:
    result = _head(path, landmarker)

    assert result.face is None
    assert result.construction is None
    # Zero confidence in any construction — not `None`, which would mean "does not apply".
    assert result.metadata.confidence == 0.0
    assert LIMITATION_NO_FACE in result.metadata.limitations


def test_the_detector_has_a_small_face_limit(landmarker: OpenLandmarker) -> None:
    """Measured 2026-09-11 (#45): no face at a fifth of the frame's height, found at a quarter."""
    assert find_face(_crop_around_full_length_face(0.20), landmarker=landmarker) is None
    assert find_face(_crop_around_full_length_face(0.25), landmarker=landmarker) is not None


# --- Construction and correction ---------------------------------------------------------------


def test_a_corrected_chin_moves_the_chin_line(landmarker: OpenLandmarker) -> None:
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
    landmarker: OpenLandmarker,
) -> None:
    face = _face(FRONTAL, landmarker)

    with pytest.raises(ValueError, match="not an anchor"):
        construct_from_face(
            face, width=100, height=100, corrections={"ear": NormalizedPoint(x=0.1, y=0.1)}
        )


# --- The recipe -------------------------------------------------------------------------------


@pytest.mark.parametrize("path", [TURNED_RIGHT, PROFILE], ids=["face", "no-face"])
def test_a_result_reloads_from_json_exactly(path: Path, landmarker: OpenLandmarker) -> None:
    """A stored result is reloaded, never recomputed — so it has to read back as it was."""
    result = _head(path, landmarker)

    assert HeadConstructionResult.model_validate_json(result.model_dump_json()) == result


def test_the_recipe_records_the_parameters_the_landmarker_ran_with(
    landmarker: OpenLandmarker,
) -> None:
    result = _head(FRONTAL, landmarker)

    assert result.metadata.parameters["detection"] == landmarker.parameters.model_dump()


def test_a_landmarker_opened_with_other_parameters_is_refused(
    landmarker: OpenLandmarker,
) -> None:
    """Recording one set of thresholds while another ran would break the FR-305 recipe.

    The mismatched handle pairs the shared detector with other parameters rather than opening a
    second one, so this test costs no extra usage report.
    """
    mismatched = OpenLandmarker(
        parameters=FaceDetectionParameters(min_detection_confidence=0.9),
        landmarker=landmarker.landmarker,
    )

    with pytest.raises(ValueError, match="different detection parameters"):
        construct_head(
            _image(FRONTAL),
            source_checksum=CHECKSUM,
            parameters=HeadConstructionParameters(),
            landmarker=mismatched,
        )


def test_the_version_names_the_runtime_and_the_model(landmarker: OpenLandmarker) -> None:
    version = _head(FRONTAL, landmarker).metadata.tool_version

    assert f"mediapipe-{mediapipe.__version__}" in version
    assert ".face_landmarker-" in version


def test_without_a_landmarker_one_is_opened_for_the_call() -> None:
    """The product path: a landmarker per call. This test sends one usage report of its own."""
    result = construct_head(_image(FRONTAL), source_checksum=CHECKSUM)

    assert result.face is not None
