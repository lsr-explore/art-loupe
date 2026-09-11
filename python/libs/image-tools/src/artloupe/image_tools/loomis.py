"""The Loomis construction, fitted to a face's anchors (`docs/design/loomis-construction.md`).

**Measured elements pass through the sitter's own points; chosen elements are labelled.** The
centre, brow, eye, nose and chin lines go where the detector placed the features. The cranial
ball and side planes are scaffold the photograph cannot show, drawn from the measured points by
two labelled factors — the ball's radius as a multiple of the measured brow-to-nose distance,
and how far out from the ball's centre each side plane is cut. Nothing here scores a face against
the method's ideal thirds: the one ratio reported is a measurement, never a verdict (spec §3).

**It is a function of the anchors**, so a corrected anchor simply recomputes it (FR-403/404).
The eye corners are the only other input, measured and not draggable.

**Posed in 3D, projected flat.** Points are in landmark space in pixels — `x·W`, `y·H`, `z·W`,
since MediaPipe's `z` shares `x`'s scale — so the lines wrap around the ball as the head turns,
and the projection drops depth. That is orthographic: it assumes the head is far from the lens
relative to its own depth, which a close wide-angle selfie breaks.
"""

import math
from collections.abc import Mapping
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, model_validator

from artloupe.image_tools.faces import AnchorName
from artloupe.image_tools.perspective import NormalizedPoint

ElementName = Literal[
    "centre_line",
    "brow_line",
    "eye_line",
    "nose_line",
    "chin_line",
    "cranial_ball",
    "cranial_centre_line",
    "right_side_plane",
    "left_side_plane",
]
ClaimKind = Literal["measured", "chosen"]

# A side plane is drawn while its outward normal is within this much (as the sine of the angle) of
# edge-on toward the camera. A frontal head shows both as thin ovals; a turned head shows only the
# near one, since the far one is hidden behind the ball.
_SIDE_PLANE_EDGE_TOLERANCE = 0.15

# The cranial centre line runs over the ball from the brow to this far past the crown.
_CRANIAL_ARC_DEG = 115.0


class ConstructionParameters(BaseModel):
    """What the construction is drawn with. Both factors are chosen, not measured or cited."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    # The cranial ball's radius, as a multiple of the measured brow-to-nose distance. A chosen,
    # labelled judgement set by eye against the pose fixtures (Laurie, 2026-09-11); a sourced
    # value replaces it once the retrieval corpus carries one.
    ball_radius_factor: float = Field(default=1.35, gt=0.5, le=3.0)
    # How far out from the ball's centre each side plane is cut, as a fraction of its radius. The
    # nose, chin and eye lines reach across the face to the side planes.
    side_plane_offset: float = Field(default=0.6, gt=0.0, lt=1.0)
    # Points sampled along each curved element.
    samples: int = Field(default=48, ge=8, le=256)


class ConstructionElement(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: ElementName
    claim: ClaimKind
    # In the overlay's normalized space, unclamped: the ball routinely reaches past the frame.
    points: list[NormalizedPoint] = Field(min_length=2)
    closed: bool

    @model_validator(mode="after")
    def _closed_needs_three(self) -> "ConstructionElement":
        if self.closed and len(self.points) < 3:
            raise ValueError("a closed element needs at least three points")
        return self


class LoomisConstruction(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    elements: list[ConstructionElement]
    # Measured along the head's vertical axis, in source pixels.
    brow_to_nose_px: float = Field(gt=0.0)
    nose_to_chin_px: float = Field(gt=0.0)
    # Chosen: `ball_radius_factor × brow_to_nose_px`.
    ball_radius_px: float = Field(gt=0.0)

    @property
    def middle_to_lower_ratio(self) -> float:
        """Brow-to-nose over nose-to-chin: a measurement an artist can use, never a score."""
        return self.brow_to_nose_px / self.nose_to_chin_px


def _unit(vector: NDArray[np.float64], what: str) -> NDArray[np.float64]:
    length = float(np.linalg.norm(vector))
    if length < 1e-9:
        raise ValueError(f"the anchors do not define {what}")
    return vector / length


def _normalized(
    points: list[NDArray[np.float64]], width: int, height: int
) -> list[NormalizedPoint]:
    return [
        NormalizedPoint(x=float(point[0]) / width, y=float(point[1]) / height) for point in points
    ]


def construct(
    anchors_px: Mapping[AnchorName, NDArray[np.float64]],
    eye_corners_px: tuple[NDArray[np.float64], NDArray[np.float64]],
    *,
    width: int,
    height: int,
    parameters: ConstructionParameters | None = None,
) -> LoomisConstruction:
    """Fit the construction to five anchors and the outer eye corners, all in landmark pixels.

    Raises `ValueError` when the anchors are degenerate — the chin on the brow, the sides on the
    centre line, or the nose above the brow — which only a correction can produce.
    """
    params = parameters or ConstructionParameters()
    brow, nose, chin = anchors_px["brow"], anchors_px["nose"], anchors_px["chin"]

    # The head's frame, from the anchors themselves: up the centre line, across between the
    # sides, and forward toward the camera, which looks along +z.
    up = _unit(brow - chin, "a vertical axis")
    across_raw = anchors_px["left_side"] - anchors_px["right_side"]
    across = _unit(across_raw - float(np.dot(across_raw, up)) * up, "a horizontal axis")
    forward = np.cross(up, across)
    if forward[2] > 0:
        forward = -forward

    brow_to_nose = float(np.dot(brow - nose, up))
    nose_to_chin = float(np.dot(nose - chin, up))
    if brow_to_nose <= 0 or nose_to_chin <= 0:
        raise ValueError("the nose must lie between the brow and the chin")

    radius = params.ball_radius_factor * brow_to_nose
    # The brow sits on the ball's front, at its equator.
    centre = brow - forward * radius
    half = params.side_plane_offset * radius

    def arc(
        first: NDArray, second: NDArray, around: NDArray, span_deg: tuple[float, float]
    ) -> list:
        angles = np.radians(np.linspace(span_deg[0], span_deg[1], params.samples))
        return [
            around + radius * (math.cos(angle) * first + math.sin(angle) * second)
            for angle in angles
        ]

    def across_line(through: NDArray) -> list:
        return [through - half * across, through + half * across]

    def visible(points: list) -> list:
        """The part of an arc on the ball's camera-facing half; the rest runs behind the head.

        The brow always survives — it is the ball's front — so an arc keeps at least its
        neighbourhood of the brow.
        """
        return [point for point in points if (point - centre)[2] <= 1e-6 * radius]

    eye_centre = (eye_corners_px[0] + eye_corners_px[1]) / 2.0
    ball = [
        np.array([centre[0] + radius * math.cos(angle), centre[1] + radius * math.sin(angle), 0.0])
        for angle in np.radians(np.linspace(0.0, 360.0, params.samples, endpoint=False))
    ]
    elements = [
        ("centre_line", "measured", [brow, nose, chin], False),
        # The front half of the ball's equator: through the measured brow, curved by the ball.
        ("brow_line", "measured", visible(arc(forward, across, centre, (-90.0, 90.0))), False),
        ("eye_line", "measured", across_line(eye_centre), False),
        ("nose_line", "measured", across_line(nose), False),
        ("chin_line", "measured", across_line(chin), False),
        # A sphere projects orthographically to a circle of its own radius.
        ("cranial_ball", "chosen", ball, True),
        (
            "cranial_centre_line",
            "chosen",
            visible(arc(forward, up, centre, (_CRANIAL_ARC_DEG, 0.0))),
            False,
        ),
    ]
    plane_radius = math.sqrt(radius**2 - half**2)
    for name, sign in (("right_side_plane", -1.0), ("left_side_plane", 1.0)):
        if sign * across[2] > _SIDE_PLANE_EDGE_TOLERANCE:
            continue  # turned away from the camera, behind the ball
        ring_centre = centre + sign * half * across
        angles = np.radians(np.linspace(0.0, 360.0, params.samples, endpoint=False))
        ring = [
            ring_centre + plane_radius * (math.cos(angle) * up + math.sin(angle) * forward)
            for angle in angles
        ]
        elements.append((name, "chosen", ring, True))

    return LoomisConstruction(
        elements=[
            ConstructionElement(
                name=name,
                claim=claim,
                points=_normalized(points, width, height),
                closed=closed,
            )
            for name, claim, points, closed in elements
        ],
        brow_to_nose_px=brow_to_nose,
        nose_to_chin_px=nose_to_chin,
        ball_radius_px=radius,
    )
