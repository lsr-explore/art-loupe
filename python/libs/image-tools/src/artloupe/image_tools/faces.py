"""Face landmarks, head pose, and how far a construction built on them can be trusted.

MediaPipe's face landmarker finds 478 landmarks and the head's pose. It reports no confidence of
its own — per-landmark `visibility` and `presence` are `None`, and its `min_*_confidence` options
are thresholds, not scores (`docs/spikes/mediapipe-feasibility.md` §4). So the number attached
here is **derived**, and named for what it is: `facial_landmark_reliability`, never "confidence"
(`docs/design/geometry-confidence-plan.md` §3). It measures the conditions the observation was
made under — how far the head is turned or nodded, how many source pixels the face covers, and
whether an anchor's surface faces away from the camera — and never the face itself.

**Pose is corrected for framing.** The detector's pose depends on where the face sits in the
frame: the same face reads 8–10° more chin-down at the top of a photograph than at the bottom,
and a face at the edge of a wide frame reads as turned less than it is — though a head's angle
cannot change with its position in the picture. The pose reported here is the detector's,
rotated to the line of sight through the face's centre (`FRAMING_VFOV_DEG`); the detector's own
angles travel beside it.

**Every close sends Google a usage report** (#43). The landmarker is created and closed per call
unless the caller passes one in, so each photograph analysed sends one;
`docs/about-site/data-sent-to-google.md` tells the artist.

**Orientation and resolution are the caller's job.** EXIF must already be applied, and the image
should be the full-resolution original: the scale signal counts source pixels, and a downscaled
copy would read as a smaller face.
"""

import math
from collections import defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from functools import cache
from pathlib import Path
from typing import Any, Literal

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions, RunningMode
from mediapipe.tasks.python.vision import face_landmarker as mp_face
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, computed_field, model_validator

MODEL_PATH = Path(__file__).resolve().parent / "models" / "face_landmarker.task"

# The scaling is Laurie's (2026-09-11), set against the pose fixtures in `fixtures/face-poses/`.
# Pose: each of yaw and pitch scores 1 at 15° or less and 0 at 60°, on the framing-corrected
# pose below. The zero sits at about 60° of real turn, past which the far side of the face is
# guessed rather than seen. (It was 45° before the framing correction, when measured angles ran
# low: the three-quarter fixture measured 37.6° and now reads 50.7°, closer to what the eye sees.)
POSE_FULL_DEG = 15.0
POSE_ZERO_DEG = 60.0
# Scale: the mesh model resizes each face crop, with a 25% margin on every side, to 256 px
# (FaceMesh-V2 model card), so below about 170 px of face its landmarks sit on upsampled pixels.
SCALE_FULL_PX = 170.0
SCALE_ZERO_PX = 64.0
# Per anchor: 1 while the anchor's surface is within 90° of the camera, 0 at 120°. A frontal
# face's chin and sides already sit near 90°, a matter of where they lie on the face's curve;
# only a surface turned away from the camera is extrapolated rather than observed.
FACING_FULL_DEG = 90.0
FACING_ZERO_DEG = 120.0

# Framing. The detector reads an off-centre face as turned toward the frame's centre. Rotating
# its pose to the line of sight through the face's centre, as if seen by a camera with this
# vertical field of view, removes most of that. Calibrated 2026-09-11 by placing each pose
# fixture at ten positions in a padded frame — where the true pose cannot change — and choosing
# the value that held it most still: the mean spread of yaw, pitch and roll across positions fell
# from 12°, 13° and 10° to 5°, 4° and 4°. A calibrated judgement, not a property of any camera; a
# genuinely wide-angle photograph keeps its real perspective, which this does not remove.
FRAMING_VFOV_DEG = 26.0

# The construction's draggable anchors (`docs/design/loomis-construction.md` §5). MediaPipe names
# sides from the sitter's point of view: its "right" is the sitter's right, image-left in a
# frontal photograph.
AnchorName = Literal["brow", "nose", "chin", "right_side", "left_side"]
ANCHOR_LANDMARKS: dict[AnchorName, int] = {
    "brow": 9,
    "nose": 2,
    "chin": 152,
    "right_side": 234,
    "left_side": 454,
}

# The top of the mesh on the forehead, and the bottom of the chin: the face height the scale
# signal counts, in source pixels. A 2D distance, so a tilt within the picture does not change it.
_FOREHEAD = 10
_CHIN = 152

# The tessellated mesh covers the first 468 landmarks; the last ten are the irises.
_MESH_LANDMARKS = 468

# MediaPipe's camera looks along -z.
_CAMERA_AXIS = np.array([0.0, 0.0, -1.0])

ReliabilitySignal = Literal["yaw", "pitch", "scale"]


class FaceDetectionParameters(BaseModel):
    """What the detector runs with. Both are MediaPipe input thresholds, recorded because they
    decide whether a face is found at all — they are not scores, and nothing reports one."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    min_detection_confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    min_presence_confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class Landmark(BaseModel):
    """One landmark, as MediaPipe defines it.

    "`x` and `y` are normalized to `[0.0, 1.0]` by the image width and height respectively. `z`
    represents the landmark depth with the depth at center of the head being the origin, and the
    smaller the value the closer the landmark is to the camera. The magnitude of `z` uses roughly
    the same scale as `x`." Not clamped: a landmark near the frame's edge can fall just outside it.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    x: FiniteFloat
    y: FiniteFloat
    z: FiniteFloat


class HeadPose(BaseModel):
    """The head's rotation relative to the line of sight through the face, in degrees.

    `yaw_deg`, `pitch_deg` and `roll_deg` are corrected for where the face sits in the frame;
    the `detector_*` angles are the detector's own, from its facial transformation matrix, kept
    so the correction stays auditable. Signs, checked against the pose fixtures: positive yaw
    turns the face toward the image's right; positive pitch tips the chin down; positive roll
    tilts the head toward the sitter's right shoulder.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    yaw_deg: FiniteFloat
    pitch_deg: FiniteFloat
    roll_deg: FiniteFloat
    detector_yaw_deg: FiniteFloat
    detector_pitch_deg: FiniteFloat
    detector_roll_deg: FiniteFloat


class FacialLandmarkReliability(BaseModel):
    """How far a construction on these landmarks can be trusted — derived, not detected.

    Three scaled signals combined with `min`, so the weakest decides and names itself; the raw
    measurements travel beside them, so a threshold applied on top stays auditable.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    yaw: float = Field(ge=0.0, le=1.0)
    pitch: float = Field(ge=0.0, le=1.0)
    scale: float = Field(ge=0.0, le=1.0)

    # The framing-corrected angles the pose signals were scaled from.
    yaw_deg: FiniteFloat
    pitch_deg: FiniteFloat
    face_height_px: float = Field(ge=0.0)

    @model_validator(mode="before")
    @classmethod
    def _recompute_on_reload(cls, data: Any) -> Any:
        """`weakest` and `value` are written to JSON for readers, and recomputed on reload.

        Without this a stored result could not be read back — `extra="forbid"` rejects the
        computed keys — and a stored value would be trusted rather than derived again.
        """
        if isinstance(data, dict):
            return {key: item for key, item in data.items() if key not in cls.model_computed_fields}
        return data

    @computed_field
    @property
    def weakest(self) -> ReliabilitySignal:
        """The signal that set the value — what an interrupt should say fired."""
        signals: dict[ReliabilitySignal, float] = {
            "yaw": self.yaw,
            "pitch": self.pitch,
            "scale": self.scale,
        }
        return min(signals, key=signals.__getitem__)

    @computed_field
    @property
    def value(self) -> float:
        """The minimum of the three signals, never a blend."""
        return min(self.yaw, self.pitch, self.scale)


class Anchor(BaseModel):
    """A draggable anchor of the construction, with its own reliability (loomis-construction §8)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: AnchorName
    landmark: int = Field(ge=0)
    point: Landmark
    # Degrees between the anchor's surface and the direction toward the camera: 0 facing it,
    # 90 edge-on, above 90 turned away.
    facing_deg: float = Field(ge=0.0, le=180.0)
    facing: float = Field(ge=0.0, le=1.0)
    # `min` of the face's reliability and `facing`.
    reliability: float = Field(ge=0.0, le=1.0)


class DetectedFace(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    landmarks: list[Landmark] = Field(min_length=478, max_length=478)
    pose: HeadPose
    facial_landmark_reliability: FacialLandmarkReliability
    anchors: list[Anchor] = Field(
        min_length=len(ANCHOR_LANDMARKS), max_length=len(ANCHOR_LANDMARKS)
    )


def _falling(value: float, full: float, zero: float) -> float:
    """1 at or below `full`, 0 at or beyond `zero`, linear between."""
    if value <= full:
        return 1.0
    if value >= zero:
        return 0.0
    return (zero - value) / (zero - full)


def _rising(value: float, zero: float, full: float) -> float:
    """0 at or below `zero`, 1 at or beyond `full`, linear between."""
    if value >= full:
        return 1.0
    if value <= zero:
        return 0.0
    return (value - zero) / (full - zero)


@cache
def _mesh_triangles() -> tuple[tuple[int, int, int], ...]:
    """The mesh's triangles, recovered as the 3-cycles of MediaPipe's tessellation edges."""
    neighbours: defaultdict[int, set[int]] = defaultdict(set)
    for edge in mp_face.FaceLandmarksConnections.FACE_LANDMARKS_TESSELATION:
        neighbours[edge.start].add(edge.end)
        neighbours[edge.end].add(edge.start)
    triangles = {
        tuple(sorted((first, second, third)))
        for first, adjacent in neighbours.items()
        for second in adjacent
        for third in adjacent & neighbours[second]
    }
    return tuple(sorted(triangles))  # type: ignore[arg-type]


def _facing_degrees(points_px: NDArray[np.float64]) -> NDArray[np.float64]:
    """Degrees between each mesh vertex's outward surface normal and the direction to the camera.

    Normals are the area-weighted sum of the vertex's triangles, oriented away from the head's
    centre — the mean landmark position at depth 0, which MediaPipe defines as the head's centre.
    The camera looks along +z (smaller z is nearer), so "toward the camera" is -z.
    """
    mesh = points_px[:_MESH_LANDMARKS]
    centre = np.array([mesh[:, 0].mean(), mesh[:, 1].mean(), 0.0])
    normals = np.zeros_like(mesh)
    for first, second, third in _mesh_triangles():
        normal = np.cross(mesh[second] - mesh[first], mesh[third] - mesh[first])
        if np.dot(normal, (mesh[first] + mesh[second] + mesh[third]) / 3.0 - centre) < 0:
            normal = -normal
        for vertex in (first, second, third):
            normals[vertex] += normal
    lengths = np.linalg.norm(normals, axis=1)
    toward_camera = -normals[:, 2] / np.where(lengths > 0, lengths, 1.0)
    return np.degrees(np.arccos(np.clip(toward_camera, -1.0, 1.0)))


def _euler(rotation: NDArray[np.float64]) -> tuple[float, float, float]:
    """Yaw, pitch and roll in degrees, in the convention `HeadPose` documents."""
    return (
        math.degrees(math.asin(float(np.clip(-rotation[2, 0], -1.0, 1.0)))),
        math.degrees(math.atan2(rotation[2, 1], rotation[2, 2])),
        math.degrees(math.atan2(rotation[1, 0], rotation[0, 0])),
    )


def _rotation_between(source: NDArray[np.float64], target: NDArray[np.float64]) -> NDArray:
    """The smallest rotation taking the direction `source` onto the direction `target`."""
    source = source / np.linalg.norm(source)
    target = target / np.linalg.norm(target)
    axis = np.cross(source, target)
    sine = float(np.linalg.norm(axis))
    cosine = float(np.dot(source, target))
    if sine < 1e-12:
        return np.eye(3)
    skew = np.array([[0.0, -axis[2], axis[1]], [axis[2], 0.0, -axis[0]], [-axis[1], axis[0], 0.0]])
    return np.eye(3) + skew + skew @ skew * ((1.0 - cosine) / sine**2)


def _pose(
    matrix: NDArray[np.float64], centre_x: float, centre_y: float, width: int, height: int
) -> HeadPose:
    """The detector's rotation, re-expressed relative to the line of sight through the face.

    `centre_x` and `centre_y` are the face's centre in normalized image coordinates.
    """
    rotation = matrix[:3, :3] / np.linalg.norm(matrix[:3, 0])
    focal = (height / 2.0) / math.tan(math.radians(FRAMING_VFOV_DEG) / 2.0)
    ray = np.array([(centre_x - 0.5) * width / focal, -(centre_y - 0.5) * height / focal, -1.0])
    yaw, pitch, roll = _euler(_rotation_between(_CAMERA_AXIS, ray).T @ rotation)
    detector_yaw, detector_pitch, detector_roll = _euler(rotation)
    return HeadPose(
        yaw_deg=yaw,
        pitch_deg=pitch,
        roll_deg=roll,
        detector_yaw_deg=detector_yaw,
        detector_pitch_deg=detector_pitch,
        detector_roll_deg=detector_roll,
    )


def _as_rgb(image: NDArray[np.uint8]) -> NDArray[np.uint8]:
    if image.dtype != np.uint8:
        raise ValueError(f"expected a uint8 image, got {image.dtype}")
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
    if image.ndim == 3 and image.shape[2] == 3:
        return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    raise ValueError(f"expected a grayscale or BGR image, got shape {image.shape}")


class OpenLandmarker(BaseModel):
    """A landmarker and the parameters it was opened with, carried together.

    Sharing one across calls is how the tests send Google one usage report rather than one per
    photograph (#43). Because the handle carries its own parameters, a call records what actually
    ran — and refuses different ones — instead of trusting a caller to keep the two in step.
    """

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    parameters: FaceDetectionParameters
    landmarker: FaceLandmarker


@contextmanager
def open_landmarker(parameters: FaceDetectionParameters) -> Iterator[OpenLandmarker]:
    """A landmarker built from `parameters`. Closing it sends Google a usage report (#43)."""
    options = FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=parameters.min_detection_confidence,
        min_face_presence_confidence=parameters.min_presence_confidence,
        output_facial_transformation_matrixes=True,
    )
    with FaceLandmarker.create_from_options(options) as landmarker:
        yield OpenLandmarker(parameters=parameters, landmarker=landmarker)


def find_face(
    image: NDArray[np.uint8],
    *,
    parameters: FaceDetectionParameters | None = None,
    landmarker: OpenLandmarker | None = None,
) -> DetectedFace | None:
    """The most prominent face, with its pose and reliability — or `None` when none is found.

    `image` is a uint8 grayscale or BGR array, EXIF-oriented, at full resolution. `None` is the
    deterministic portrait gate's answer: a head turned too far, or a face too small for the
    bundled detector (#45), both come back as no face at all. A shared `landmarker` runs with the
    parameters it was opened with; passing different ones as well is refused.
    """
    frame = mp.Image(image_format=mp.ImageFormat.SRGB, data=_as_rgb(image))
    if landmarker is not None:
        if parameters is not None and parameters != landmarker.parameters:
            raise ValueError("the landmarker was opened with different detection parameters")
        result = landmarker.landmarker.detect(frame)
    else:
        with open_landmarker(parameters or FaceDetectionParameters()) as own:
            result = own.landmarker.detect(frame)
    if not result.face_landmarks:
        return None

    height, width = image.shape[:2]
    raw = result.face_landmarks[0]
    landmarks = [Landmark(x=point.x, y=point.y, z=point.z) for point in raw]
    points_px = np.array([[point.x * width, point.y * height, point.z * width] for point in raw])
    pose = _pose(
        np.asarray(result.facial_transformation_matrixes[0], dtype=np.float64),
        float(np.mean([point.x for point in raw])),
        float(np.mean([point.y for point in raw])),
        width,
        height,
    )
    face_height_px = float(np.linalg.norm(points_px[_FOREHEAD, :2] - points_px[_CHIN, :2]))
    reliability = FacialLandmarkReliability(
        yaw=_falling(abs(pose.yaw_deg), POSE_FULL_DEG, POSE_ZERO_DEG),
        pitch=_falling(abs(pose.pitch_deg), POSE_FULL_DEG, POSE_ZERO_DEG),
        scale=_rising(face_height_px, SCALE_ZERO_PX, SCALE_FULL_PX),
        yaw_deg=pose.yaw_deg,
        pitch_deg=pose.pitch_deg,
        face_height_px=face_height_px,
    )
    facing = _facing_degrees(points_px)
    anchors = []
    for name, index in ANCHOR_LANDMARKS.items():
        facing_score = _falling(float(facing[index]), FACING_FULL_DEG, FACING_ZERO_DEG)
        anchors.append(
            Anchor(
                name=name,
                landmark=index,
                point=landmarks[index],
                facing_deg=float(facing[index]),
                facing=facing_score,
                reliability=min(reliability.value, facing_score),
            )
        )
    return DetectedFace(
        landmarks=landmarks,
        pose=pose,
        facial_landmark_reliability=reliability,
        anchors=anchors,
    )
