"""The Loomis construction's geometry, on anchors placed by hand — no detector, no upload.

A frontal head is drawn in landmark pixels with every anchor at the same depth, so the head's
frame is the image's own: up is -y, across is +x, and forward — toward the camera — is -z. Every
expected position below follows from that by arithmetic, which is what lets these tests assert
exactly where the detector-backed tests can only pin behaviour.
"""

import math

import numpy as np
import pytest

from artloupe.image_tools.loomis import (
    ConstructionParameters,
    LoomisConstruction,
    construct,
)

pytestmark = pytest.mark.trace(flow="analysis.geometry", category="functionality")

WIDTH = HEIGHT = 1000
BROW_TO_NOSE = 120.0
NOSE_TO_CHIN = 180.0
DEFAULT_RADIUS = 1.35 * BROW_TO_NOSE  # the default chosen ball factor
TOLERANCE = 1e-9


def _frontal() -> dict[str, np.ndarray]:
    return {
        "brow": np.array([500.0, 400.0, -100.0]),
        "nose": np.array([500.0, 400.0 + BROW_TO_NOSE, -100.0]),
        "chin": np.array([500.0, 400.0 + BROW_TO_NOSE + NOSE_TO_CHIN, -100.0]),
        "right_side": np.array([380.0, 460.0, -100.0]),
        "left_side": np.array([620.0, 460.0, -100.0]),
    }


EYES = (np.array([430.0, 450.0, -100.0]), np.array([570.0, 450.0, -100.0]))


def _turned(degrees: float) -> tuple[dict[str, np.ndarray], tuple[np.ndarray, np.ndarray]]:
    """The frontal head turned about its vertical axis, through the default ball's centre."""
    angle = math.radians(degrees)
    pivot = np.array([500.0, 0.0, -100.0 + DEFAULT_RADIUS])

    def turn(point: np.ndarray) -> np.ndarray:
        offset = point - pivot
        return pivot + np.array(
            [
                offset[0] * math.cos(angle) + offset[2] * math.sin(angle),
                offset[1],
                -offset[0] * math.sin(angle) + offset[2] * math.cos(angle),
            ]
        )

    return {name: turn(point) for name, point in _frontal().items()}, (
        turn(EYES[0]),
        turn(EYES[1]),
    )


def _build(**parameters: object) -> LoomisConstruction:
    return construct(
        _frontal(),
        EYES,
        width=WIDTH,
        height=HEIGHT,
        parameters=ConstructionParameters(**parameters) if parameters else None,
    )


def _element(construction: LoomisConstruction, name: str) -> list[tuple[float, float]]:
    (element,) = [item for item in construction.elements if item.name == name]
    return [(point.x, point.y) for point in element.points]


def test_measured_lines_run_level_through_their_anchors() -> None:
    construction = _build()

    for name, y in (
        ("brow_line", 0.400),
        ("eye_line", 0.450),
        ("nose_line", 0.520),
        ("chin_line", 0.700),
    ):
        assert all(abs(point_y - y) < TOLERANCE for _x, point_y in _element(construction, name))
    assert all(abs(x - 0.5) < TOLERANCE for x, _y in _element(construction, "centre_line"))


def test_the_ball_is_centred_on_the_brow_at_the_chosen_radius() -> None:
    construction = _build()
    radius = DEFAULT_RADIUS / WIDTH

    assert construction.ball_radius_px == pytest.approx(DEFAULT_RADIUS)
    for x, y in _element(construction, "cranial_ball"):
        assert math.hypot(x - 0.5, y - 0.4) == pytest.approx(radius)


def test_the_ball_factor_is_a_parameter() -> None:
    assert _build(ball_radius_factor=1.0).ball_radius_px == pytest.approx(BROW_TO_NOSE)


def test_every_element_is_labelled_measured_or_chosen() -> None:
    claims = {element.name: element.claim for element in _build().elements}

    assert {name for name, claim in claims.items() if claim == "measured"} == {
        "centre_line",
        "brow_line",
        "eye_line",
        "nose_line",
        "chin_line",
    }
    assert {name for name, claim in claims.items() if claim == "chosen"} == {
        "cranial_ball",
        "cranial_centre_line",
        "right_side_plane",
        "left_side_plane",
    }


def test_the_cranial_centre_line_stops_at_the_top_of_the_ball() -> None:
    """The arc over the crown is clipped where it turns away from the camera.

    The arc is sampled, so its last visible point falls within one sample of the ball's top: at
    the default 48 samples over 115°, a sag of under 1e-4 of the frame — invisible when drawn.
    """
    points = _element(_build(), "cranial_centre_line")
    top = 0.4 - DEFAULT_RADIUS / HEIGHT

    assert all(abs(x - 0.5) < TOLERANCE for x, _y in points)
    assert min(y for _x, y in points) == pytest.approx(top, abs=1e-4)
    # Clipped: nothing past the crown, where the arc would come back down behind the head.
    assert min(y for _x, y in points) >= top


def test_a_frontal_head_shows_both_side_planes_edge_on() -> None:
    construction = _build()
    offset = 0.6 * DEFAULT_RADIUS / WIDTH

    for name, x in (("right_side_plane", 0.5 - offset), ("left_side_plane", 0.5 + offset)):
        assert all(abs(point_x - x) < 1e-6 for point_x, _y in _element(construction, name))


def test_a_turned_head_shows_only_the_near_side_plane() -> None:
    anchors, eyes = _turned(40.0)
    construction = construct(anchors, eyes, width=WIDTH, height=HEIGHT)
    names = {element.name for element in construction.elements}

    assert "left_side_plane" in names
    assert "right_side_plane" not in names


def test_proportions_are_measured_not_scored() -> None:
    construction = _build()

    assert construction.brow_to_nose_px == pytest.approx(BROW_TO_NOSE)
    assert construction.nose_to_chin_px == pytest.approx(NOSE_TO_CHIN)
    assert construction.middle_to_lower_ratio == pytest.approx(BROW_TO_NOSE / NOSE_TO_CHIN)


def test_the_eye_line_passes_through_both_eye_corners() -> None:
    """Measured means through the sitter's own points, even when the eyes are not level."""
    uneven = (np.array([430.0, 440.0, -100.0]), np.array([570.0, 462.0, -100.0]))
    points = _element(construct(_frontal(), uneven, width=WIDTH, height=HEIGHT), "eye_line")

    for corner in uneven:
        assert any(
            math.hypot(point_x - corner[0] / WIDTH, point_y - corner[1] / HEIGHT) < 1e-9
            for point_x, point_y in points
        )


def _pitched(degrees: float) -> tuple[dict[str, np.ndarray], tuple[np.ndarray, np.ndarray]]:
    """The frontal head nodded about its horizontal axis, through the default ball's centre."""
    angle = math.radians(degrees)
    pivot = np.array([0.0, 400.0, -100.0 + DEFAULT_RADIUS])

    def nod(point: np.ndarray) -> np.ndarray:
        offset = point - pivot
        return pivot + np.array(
            [
                offset[0],
                offset[1] * math.cos(angle) - offset[2] * math.sin(angle),
                offset[1] * math.sin(angle) + offset[2] * math.cos(angle),
            ]
        )

    return {name: nod(point) for name, point in _frontal().items()}, (nod(EYES[0]), nod(EYES[1]))


def test_the_eye_line_wraps_around_a_nodding_head() -> None:
    """Level and seen straight on, the eye line is straight; nodded, it curves with the head.

    The line is a circle around the head. Seen edge-on, from its own level, a circle is a line —
    so the curve shows only when the head is seen from above or below, as in Loomis's drawings.
    """
    level = np.array(_element(_build(), "eye_line"))
    anchors, eyes = _pitched(25.0)
    nodded = np.array(_element(construct(anchors, eyes, width=WIDTH, height=HEIGHT), "eye_line"))

    def sag(points: np.ndarray) -> float:
        start, end = points[0], points[-1]
        chord = end - start
        offsets = chord[0] * (points[:, 1] - start[1]) - chord[1] * (points[:, 0] - start[0])
        return float(np.abs(offsets).max() / np.hypot(*chord))

    assert sag(level) < 1e-9
    assert sag(nodded) > 0.005


def test_the_construction_reloads_from_json_exactly() -> None:
    construction = _build()

    assert LoomisConstruction.model_validate_json(construction.model_dump_json()) == construction


@pytest.mark.parametrize(
    ("anchor", "moved_to"),
    [
        ("chin", np.array([500.0, 400.0, -100.0])),  # onto the brow: no vertical axis
        ("nose", np.array([500.0, 300.0, -100.0])),  # above the brow
        ("left_side", np.array([380.0, 460.0, -100.0])),  # onto the other side: no width
    ],
)
def test_degenerate_anchors_are_refused(anchor: str, moved_to: np.ndarray) -> None:
    anchors = _frontal()
    anchors[anchor] = moved_to

    with pytest.raises(ValueError, match="anchors|nose"):
        construct(anchors, EYES, width=WIDTH, height=HEIGHT)
