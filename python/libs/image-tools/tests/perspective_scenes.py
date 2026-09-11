"""Synthetic scenes with known vanishing points, drawn rather than photographed.

Drawn so the ground truth is exact and the fixtures carry no licence: every segment lies on a
ray through a vanishing point chosen here, in the overlay's normalized coordinates. A
photograph would need its vanishing points hand-annotated, and then the test would measure the
annotation as much as the detector.

The scenes are 1200 × 900, wider than the default working size, so every test also exercises
the downscale and the anisotropic normalized conversion.
"""

import math
from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray

WIDTH = 1200
HEIGHT = 900

# 16× sub-pixel precision for `cv2.line`, so a segment's endpoints are not rounded off its ray.
_SHIFT = 4
_SCALE = 1 << _SHIFT


@dataclass(frozen=True)
class Scene:
    image: NDArray[np.uint8]
    # Ground truth, in normalized coordinates, left to right.
    vanishing_points: list[tuple[float, float]]
    horizon_y: float


def _to_pixels(point: tuple[float, float], width: int, height: int) -> tuple[float, float]:
    """Normalized → OpenCV pixel coordinates (pixel centres at integers)."""
    return (point[0] * width - 0.5, point[1] * height - 0.5)


def _draw(image: NDArray[np.uint8], start: tuple[float, float], end: tuple[float, float]) -> None:
    cv2.line(
        image,
        (round(start[0] * _SCALE), round(start[1] * _SCALE)),
        (round(end[0] * _SCALE), round(end[1] * _SCALE)),
        color=0,
        # One pixel, not two. LSD traces each side of a stroke as its own segment, and the two
        # sides of a thick stroke sit off the ray they were drawn along — near a close
        # vanishing point that offset reads as angular residual the detector did not cause.
        thickness=1,
        lineType=cv2.LINE_AA,
        shift=_SHIFT,
    )


def _ray_segment(
    image: NDArray[np.uint8],
    anchor: tuple[float, float],
    vanishing: tuple[float, float],
    length: float,
) -> None:
    """Draw a segment of `length` pixels from `anchor` towards (or away from) `vanishing`."""
    dx, dy = vanishing[0] - anchor[0], vanishing[1] - anchor[1]
    norm = math.hypot(dx, dy)
    end = (anchor[0] + dx / norm * length, anchor[1] + dy / norm * length)
    _draw(image, anchor, end)


def _blank(width: int, height: int) -> NDArray[np.uint8]:
    return np.full((height, width), 255, dtype=np.uint8)


def two_point(width: int = WIDTH, height: int = HEIGHT) -> Scene:
    """Two families converging off-frame left and right on a level horizon, plus uprights."""
    horizon_y = 0.42
    truth = [(-0.35, horizon_y), (1.6, horizon_y)]
    image = _blank(width, height)
    length = 0.14 * max(width, height)

    for vanishing_normalized, anchor_xs in (
        (truth[0], (0.55, 0.7, 0.85)),
        (truth[1], (0.1, 0.25, 0.4)),
    ):
        vanishing = _to_pixels(vanishing_normalized, width, height)
        for anchor_x in anchor_xs:
            for anchor_y in (0.1, 0.25, 0.6, 0.75, 0.9):
                _ray_segment(
                    image, _to_pixels((anchor_x, anchor_y), width, height), vanishing, length
                )

    for upright_x in (0.08, 0.3, 0.48, 0.66, 0.92):
        _draw(
            image,
            _to_pixels((upright_x, 0.15), width, height),
            _to_pixels((upright_x, 0.85), width, height),
        )
    return Scene(image=image, vanishing_points=truth, horizon_y=horizon_y)


def one_point(width: int = WIDTH, height: int = HEIGHT) -> Scene:
    """Receding lines converging inside the frame, crossed by horizontals and uprights."""
    truth = (0.55, 0.4)
    image = _blank(width, height)
    vanishing = _to_pixels(truth, width, height)
    long_edge = max(width, height)

    for angle_deg in range(10, 360, 25):
        angle = math.radians(angle_deg)
        # Start away from the point itself, so no segment's midpoint sits on it.
        anchor = (
            vanishing[0] + math.cos(angle) * 0.18 * long_edge,
            vanishing[1] + math.sin(angle) * 0.18 * long_edge,
        )
        away = (2 * anchor[0] - vanishing[0], 2 * anchor[1] - vanishing[1])
        _ray_segment(image, anchor, away, 0.16 * long_edge)

    for level_y in (0.08, 0.92):
        _draw(
            image,
            _to_pixels((0.05, level_y), width, height),
            _to_pixels((0.95, level_y), width, height),
        )
    for upright_x in (0.04, 0.96):
        _draw(
            image,
            _to_pixels((upright_x, 0.1), width, height),
            _to_pixels((upright_x, 0.9), width, height),
        )
    return Scene(image=image, vanishing_points=[truth], horizon_y=truth[1])


def single_family(
    lines: int,
    *,
    jitter_deg: float = 0.0,
    clutter: int = 0,
    seed: int = 1,
    width: int = WIDTH,
    height: int = HEIGHT,
) -> Scene:
    """One family converging off-frame right, degraded on purpose.

    Each knob attacks one confidence signal: fewer `lines` lowers support, `jitter_deg` aims
    each line off the point by up to that angle and lowers the angular fit, and `clutter` adds
    randomly oriented segments that converge on nothing.
    """
    rng = np.random.default_rng(seed)
    horizon_y = 0.42
    truth = (1.6, horizon_y)
    image = _blank(width, height)
    vanishing = _to_pixels(truth, width, height)
    length = 0.14 * max(width, height)

    anchors = [
        (anchor_x, anchor_y)
        for anchor_x in np.linspace(0.1, 0.45, lines // 3 + 1)
        for anchor_y in (0.1, 0.3, 0.7, 0.9)
    ][:lines]
    for anchor_normalized in anchors:
        anchor = _to_pixels(anchor_normalized, width, height)
        aim = math.atan2(vanishing[1] - anchor[1], vanishing[0] - anchor[0])
        aim += math.radians(rng.uniform(-jitter_deg, jitter_deg))
        _draw(
            image, anchor, (anchor[0] + math.cos(aim) * length, anchor[1] + math.sin(aim) * length)
        )

    for _index in range(clutter):
        start = (rng.uniform(0, width), rng.uniform(0, height))
        heading = rng.uniform(0, math.pi)
        span = rng.uniform(0.04, 0.12) * width
        _draw(
            image, start, (start[0] + math.cos(heading) * span, start[1] + math.sin(heading) * span)
        )

    return Scene(image=image, vanishing_points=[truth] if lines else [], horizon_y=horizon_y)


def noise(width: int = WIDTH, height: int = HEIGHT, seed: int = 7) -> NDArray[np.uint8]:
    """Blurred noise: plenty of edges, no structure converging anywhere."""
    rng = np.random.default_rng(seed)
    raw = rng.integers(0, 256, size=(height, width), dtype=np.uint8)
    return cv2.GaussianBlur(raw, (0, 0), sigmaX=3)


def blank(width: int = WIDTH, height: int = HEIGHT) -> NDArray[np.uint8]:
    """No edges at all."""
    return _blank(width, height)
