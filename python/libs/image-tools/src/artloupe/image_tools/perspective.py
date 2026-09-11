"""The perspective tool: horizon and vanishing-point *candidates*, each with a measured confidence.

FR-302 asks for one- and two-point perspective, artist-correctable; FR-401 asks for a
confidence on each feature; FR-402 interrupts the run when one is low. So this returns
candidates, not an answer — the confidence is what decides whether the artist is asked.

**Confidence is measured, and it is the weakest of three signals.** Each vanishing point
carries the three measurements its fit produced, each scaled to `[0, 1]`:

- `significance` — how far above chance the support is. Among enough unrelated segments some
  point always collects agreement by coincidence, and RANSAC will find it; this is low when
  that is all the point is. It is the signal that separates clutter from structure.
- `angular_fit` — how tightly the supporting segments converge: 1 at a perfect fit, 0 when
  their mean residual reaches the inlier threshold.
- `support` — how many segments converge, saturating at `FULL_SUPPORT_SEGMENTS`. Low when a
  point rests on a handful of lines — which `significance` cannot see, since two isolated
  lines are far above chance and still flimsy evidence.

They combine with `min`, not a mean, because they are independent ways for the point to be
wrong: a mean lets two good signals hide one bad one, which is exactly the case the interrupt
exists to catch. `min` also names *which* signal decided, and FR-402's correction UI needs
that anyway. This is the same rule `geometry-confidence-plan.md` §3 sets for PR 10's face path,
but the word differs deliberately: this number comes out of the estimation itself, so it is
a confidence; the face path's is derived, and is not called one.

**Coordinates** are in the overlay's normalized space — `[0, 1]` on each axis, origin top-left
— and are **not clamped**. A two-point vanishing point is routinely outside the photograph;
clamping it would report a different point. (The overlay primitives cannot yet show one there:
issue #40.)

**Orientation is the caller's job.** The image must already be in its displayed orientation —
EXIF applied — or every coordinate lands on the wrong spot of the photograph the artist sees.
"""

import math
import time
from typing import Literal

import cv2
import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, computed_field

from artloupe.image_tools.segments import ImageFrame, detect_segments
from artloupe.image_tools.vanishing import Family, find_families
from artloupe.schemas.artifact import ArtifactMetadata
from artloupe.schemas.evidence import Checksum

# Bump when the algorithm or any constant below changes what a given input produces. The
# OpenCV version is appended at run time, because LSD's output can move between releases and
# the FR-305 recipe `(source_checksum, tool, tool_version, parameters)` must reproduce exactly.
PERSPECTIVE_ALGORITHM_VERSION = "1"

# FR-302 covers one- and two-point perspective, so at most two points are reported.
MAX_VANISHING_POINTS = 2

# Families searched for, before any is set aside as vertical or parallel. A real scene spends
# some of its strongest families on uprights and near-parallel edges: in the Murano canal
# photograph, the convergence on the bridge is only the fourth family found, behind the
# verticals and two facade families. Searching just one more than is reported lost it.
_MAX_FAMILIES = MAX_VANISHING_POINTS + 3

# `support` reaches 1.0 at this many converging segments. Below it, each missing segment
# costs confidence linearly. Twelve is a judgement, not a measurement: a building edge seen
# by LSD commonly yields two or three segments, so this is four or five real edges.
FULL_SUPPORT_SEGMENTS = 12

# `significance` reaches 1.0 when this many times more segments converge than chance predicts,
# and is 0 at exactly chance. Measured on drawn scenes: real structure lands at 17-60×, points
# RANSAC finds in pure random clutter at 3-5×, and clutter points found alongside real
# structure at 9-12×. Twenty sits above all of that clutter, and below most drawn structure.
# Photographs are harder: the canal's real convergence on the bridge is only 9×, level with
# drawn clutter, so on a photograph this signal ranks points well but does not by itself
# separate real from coincidental. Like the other scaling constants it is a judgement; PR 13's
# threshold is where photographs get a say.
FULL_SIGNIFICANCE_MULTIPLE = 20.0

# A family whose point lies further than this from the image centre, in long-edge units, is
# treated as parallel lines rather than a vanishing point. Beyond it the point's position is
# too poorly constrained to draw or correct meaningfully.
MAX_VANISHING_DISTANCE = 10.0

# A family whose point lies within this angle of straight up or down from the image centre,
# and outside the frame vertically, is the scene's verticals — three-point convergence, or
# near-parallel uprights — not a point on the horizon.
VERTICAL_TOLERANCE_DEG = 20.0

LIMITATION_NOT_VALIDATED = (
    "Detection is not tuned or validated against a gold set; the confidence measures how well "
    "the detected lines converge, not whether the detected structure is the one that matters."
)
LIMITATION_NO_VERTICAL = "Vertical convergence (three-point perspective) is not reported."
LIMITATION_PARALLEL = (
    "Line families whose vanishing point lies more than "
    f"{MAX_VANISHING_DISTANCE:g} image-lengths away are treated as parallel and not reported."
)
LIMITATION_NONE_FOUND = "No vanishing point had enough converging lines to report."
LIMITATION_LEVEL_HORIZON = (
    "With one vanishing point the horizon is drawn level through it; camera roll is assumed "
    "to be zero, not measured."
)
LIMITATION_NO_HORIZON = (
    "The two vanishing points lie one above the other, so no horizon can be drawn through them."
)


class PerspectiveParameters(BaseModel):
    """What the tool runs with. Recorded verbatim, after validation, in the FR-305 metadata."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    # Images are downscaled to this long edge before detection. Normalized output does not
    # depend on it; run time and the number of texture fragments LSD reports do.
    working_long_edge_px: int = Field(default=1024, ge=256, le=4096)
    # Shorter segments are discarded, as a fraction of the long edge.
    min_segment_length: float = Field(default=0.025, gt=0.0, lt=1.0)
    # A segment supports a point when it points at it within this angle.
    inlier_threshold_deg: float = Field(default=1.5, gt=0.0, le=10.0)
    # RANSAC hypotheses per family.
    hypotheses: int = Field(default=2000, ge=100, le=20000)
    # RANSAC is random; the seed is part of the recipe, so the same input reproduces.
    seed: int = 0


class NormalizedPoint(BaseModel):
    """A point in the overlay's normalized space. Deliberately unbounded — see module doc."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    x: FiniteFloat
    y: FiniteFloat


ConfidenceSignal = Literal["significance", "angular_fit", "support"]


class VanishingPointConfidence(BaseModel):
    """The three scaled signals, and the raw measurements they were scaled from.

    The raw measurements travel with the scaled ones so the scaling stays auditable: a
    `chosen` threshold applied on top of `value` can be traced back to what was measured.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    significance: float = Field(ge=0.0, le=1.0)
    angular_fit: float = Field(ge=0.0, le=1.0)
    support: float = Field(ge=0.0, le=1.0)

    supporting_segments: int = Field(ge=0)
    # Times more supporting segments than chance predicts among those unclaimed at the fit.
    chance_multiple: float = Field(ge=0.0)
    mean_residual_deg: float = Field(ge=0.0)

    @computed_field
    @property
    def weakest(self) -> ConfidenceSignal:
        """The signal that set the confidence — what an interrupt should say fired."""
        signals: dict[ConfidenceSignal, float] = {
            "significance": self.significance,
            "angular_fit": self.angular_fit,
            "support": self.support,
        }
        return min(signals, key=signals.__getitem__)

    @computed_field
    @property
    def value(self) -> float:
        """The confidence: the minimum of the three signals, never a blend."""
        return min(self.significance, self.angular_fit, self.support)


class VanishingPoint(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    point: NormalizedPoint
    confidence: VanishingPointConfidence


class Horizon(BaseModel):
    """The horizon as the two points where it crosses the photograph's left and right edges."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    # At `x = 0` and `x = 1`. `y` may fall outside `[0, 1]` when the horizon is off-frame.
    left: NormalizedPoint
    right: NormalizedPoint
    # The weakest confidence among the vanishing points it was drawn through.
    confidence: float = Field(ge=0.0, le=1.0)
    # True when drawn level through one vanishing point: the tilt is then an assumption, not a
    # measurement, and must not be cited as one.
    level_assumed: bool


class PerspectiveResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    # Left to right, at most `MAX_VANISHING_POINTS`.
    vanishing_points: list[VanishingPoint] = Field(max_length=MAX_VANISHING_POINTS)
    horizon: Horizon | None
    metadata: ArtifactMetadata


def _score(family: Family, threshold: float) -> VanishingPointConfidence:
    supporting = len(family.inliers)
    multiple = family.chance_multiple(threshold)
    return VanishingPointConfidence(
        significance=min(1.0, max(0.0, (multiple - 1.0) / (FULL_SIGNIFICANCE_MULTIPLE - 1.0))),
        angular_fit=max(0.0, 1.0 - family.mean_residual / threshold),
        support=min(1.0, supporting / FULL_SUPPORT_SEGMENTS),
        supporting_segments=supporting,
        chance_multiple=multiple,
        mean_residual_deg=math.degrees(family.mean_residual),
    )


FamilyKind = Literal["vanishing", "vertical", "parallel"]


def _classify(family: Family, frame: ImageFrame) -> FamilyKind:
    x, y, w = family.point
    from_vertical = math.degrees(math.atan2(abs(x), abs(y)))
    at_infinity = abs(w) < 1e-9
    if from_vertical < VERTICAL_TOLERANCE_DEG and (at_infinity or abs(y / w) > frame.half_height):
        return "vertical"
    if at_infinity or math.hypot(x / w, y / w) > MAX_VANISHING_DISTANCE:
        return "parallel"
    return "vanishing"


def _as_grayscale(image: NDArray[np.uint8]) -> NDArray[np.uint8]:
    if image.dtype != np.uint8:
        raise ValueError(f"expected a uint8 image, got {image.dtype}")
    if image.ndim == 2:
        return image
    if image.ndim == 3 and image.shape[2] == 3:
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    raise ValueError(f"expected a grayscale or BGR image, got shape {image.shape}")


def _downscale(gray: NDArray[np.uint8], long_edge: int) -> NDArray[np.uint8]:
    height, width = gray.shape
    scale = long_edge / max(height, width)
    if scale >= 1.0:
        return gray
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return cv2.resize(gray, size, interpolation=cv2.INTER_AREA)


def _horizon(
    points: list[tuple[float, float]],
    confidences: list[float],
    frame: ImageFrame,
) -> Horizon | None:
    """Draw the horizon through the reported points, in the isotropic frame."""
    left_x, right_x = -frame.half_width, frame.half_width
    if len(points) == 1:
        ((_x, y),) = points
        left_y = right_y = y
    else:
        (x1, y1), (x2, y2) = points
        if abs(x2 - x1) < 1e-9:
            return None
        slope = (y2 - y1) / (x2 - x1)
        left_y = y1 + slope * (left_x - x1)
        right_y = y1 + slope * (right_x - x1)

    left = frame.to_normalized(left_x, left_y)
    right = frame.to_normalized(right_x, right_y)
    return Horizon(
        left=NormalizedPoint(x=left[0], y=left[1]),
        right=NormalizedPoint(x=right[0], y=right[1]),
        confidence=min(confidences),
        level_assumed=len(points) == 1,
    )


def detect_perspective(
    image: NDArray[np.uint8],
    *,
    source_checksum: Checksum,
    parameters: PerspectiveParameters | None = None,
) -> PerspectiveResult:
    """Find up to two vanishing points and the horizon through them.

    `image` is a uint8 grayscale or BGR array, already in its displayed orientation.
    `source_checksum` is the FR-105 checksum of the upload it was decoded from; it is recorded,
    not recomputed, because the tool never sees the original bytes.
    """
    started = time.perf_counter()
    params = parameters or PerspectiveParameters()
    threshold = math.radians(params.inlier_threshold_deg)

    gray = _downscale(_as_grayscale(image), params.working_long_edge_px)
    frame = ImageFrame(width=gray.shape[1], height=gray.shape[0])
    segments = detect_segments(gray, min_length=params.min_segment_length)
    families = find_families(
        segments,
        threshold=threshold,
        hypotheses=params.hypotheses,
        max_families=_MAX_FAMILIES,
        rng=np.random.default_rng(params.seed),
    )

    # Report the most *confident* points, not the best-supported. RANSAC orders families by
    # raw supporting length, which rewards a long run of facade edges over a tighter, more
    # significant convergence; the confidence is what the rest of the system trusts, so it is
    # what chooses. Stable sort: equal confidence keeps RANSAC's order.
    scored = [
        (family, _score(family, threshold))
        for family in families
        if _classify(family, frame) == "vanishing"
    ]
    scored.sort(key=lambda pair: pair[1].value, reverse=True)
    reported = scored[:MAX_VANISHING_POINTS]
    isotropic = [
        (family.point[0] / family.point[2], family.point[1] / family.point[2])
        for family, _confidence in reported
    ]
    order = sorted(range(len(reported)), key=lambda index: isotropic[index][0])

    vanishing_points: list[VanishingPoint] = []
    for index in order:
        x, y = frame.to_normalized(*isotropic[index])
        vanishing_points.append(
            VanishingPoint(point=NormalizedPoint(x=x, y=y), confidence=reported[index][1])
        )
    confidences = [vp.confidence.value for vp in vanishing_points]
    horizon = (
        _horizon([isotropic[index] for index in order], confidences, frame)
        if vanishing_points
        else None
    )

    limitations = [LIMITATION_NOT_VALIDATED, LIMITATION_NO_VERTICAL, LIMITATION_PARALLEL]
    if not vanishing_points:
        limitations.append(LIMITATION_NONE_FOUND)
    elif horizon is None:
        limitations.append(LIMITATION_NO_HORIZON)
    elif horizon.level_assumed:
        limitations.append(LIMITATION_LEVEL_HORIZON)

    metadata = ArtifactMetadata(
        tool="perspective",
        tool_version=f"{PERSPECTIVE_ALGORITHM_VERSION}+opencv-{cv2.__version__}",
        parameters=params.model_dump(),
        source_checksum=source_checksum,
        duration_ms=round((time.perf_counter() - started) * 1000),
        # The artifact is as trustworthy as its weakest feature. Finding nothing is a claim of
        # zero confidence in any perspective structure — not `None`, which would say the notion
        # does not apply to this tool.
        confidence=min(confidences, default=0.0),
        limitations=limitations,
    )
    return PerspectiveResult(
        vanishing_points=vanishing_points,
        horizon=horizon,
        metadata=metadata,
    )
