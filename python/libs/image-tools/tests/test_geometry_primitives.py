"""The two primitives the perspective tool is built on: the frame conversion and the residual.

Both are places where an off-by-half-a-pixel or a wrong axis would move every reported point
without breaking any shape the tool-level tests check, so they are pinned directly.
"""

import math

import numpy as np
import pytest

from artloupe.image_tools.segments import ImageFrame, Segments
from artloupe.image_tools.vanishing import residuals

pytestmark = pytest.mark.trace(flow="analysis.geometry", category="functionality")


def test_image_edges_map_to_the_overlay_unit_square() -> None:
    """Pixel centres sit at integers, so the image's edges are at -0.5 and width - 0.5."""
    frame = ImageFrame(width=400, height=300)
    corners = frame.to_isotropic(np.array([[-0.5, -0.5], [399.5, 299.5]]))

    assert frame.to_normalized(*corners[0]) == pytest.approx((0.0, 0.0))
    assert frame.to_normalized(*corners[1]) == pytest.approx((1.0, 1.0))
    assert corners[1] == pytest.approx((frame.half_width, frame.half_height))


def test_the_isotropic_frame_preserves_angles() -> None:
    """A 45° line in pixels stays 45° — the property the overlay's normalized space lacks."""
    frame = ImageFrame(width=400, height=100)
    start, end = frame.to_isotropic(np.array([[0.0, 0.0], [50.0, 50.0]]))
    assert math.degrees(math.atan2(end[1] - start[1], end[0] - start[0])) == pytest.approx(45.0)


def _one_segment(start: tuple[float, float], end: tuple[float, float]) -> Segments:
    return Segments(start=np.array([start]), end=np.array([end]))


def test_a_segment_pointing_at_the_point_has_zero_residual() -> None:
    segment = _one_segment((0.0, 0.0), (0.1, 0.1))
    point = np.array([[1.0, 1.0, 1.0]]) / math.sqrt(3)
    assert residuals(point, segment.midpoints, segment.directions)[0, 0] == pytest.approx(0.0)


def test_a_perpendicular_segment_has_a_right_angle_residual() -> None:
    segment = _one_segment((0.0, -0.1), (0.0, 0.1))
    point = np.array([[1.0, 0.0, 1.0]]) / math.sqrt(2)
    residual = residuals(point, segment.midpoints, segment.directions)[0, 0]
    assert residual == pytest.approx(math.pi / 2)


def test_a_point_at_infinity_is_supported_by_parallel_segments() -> None:
    """`w = 0` is a direction, not an overflow: segments parallel to it support it."""
    segments = Segments(
        start=np.array([[0.0, 0.0], [0.0, 0.3]]),
        end=np.array([[0.2, 0.0], [0.2, 0.3]]),
    )
    horizontal_infinity = np.array([[1.0, 0.0, 0.0]])
    fit = residuals(horizontal_infinity, segments.midpoints, segments.directions)[0]
    assert fit == pytest.approx([0.0, 0.0])


def test_residual_ignores_which_way_the_segment_was_drawn() -> None:
    forwards = _one_segment((0.0, 0.0), (0.1, 0.02))
    backwards = _one_segment((0.1, 0.02), (0.0, 0.0))
    point = np.array([[0.5, 0.3, 1.0]])
    assert residuals(point, forwards.midpoints, forwards.directions) == pytest.approx(
        residuals(point, backwards.midpoints, backwards.directions)
    )
