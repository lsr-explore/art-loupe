"""The plate suite: one pipeline, three plates that correspond, and edges measured honestly.

Unlike detection, a plate is right or wrong by construction: a value map divides the photograph
where its thresholds say, and an outline traces the value map's own boundaries or it has broken.
So these assert exactly, on drawn scenes. The correspondence is asserted hardest — every contour
point sits on an edge of the value map — because it is the guarantee the one-pipeline design
exists to give, and an independent edge detector bolted on beside it would pass everything else.
"""

import cv2
import numpy as np
import plate_scenes as scenes
import pytest
from pydantic import ValidationError

from artloupe.image_tools import DETAIL_LEVELS, PlateParameters, PlateSuite, make_plates
from artloupe.image_tools.plates import (
    LIMITATION_EMPTY_VALUE,
    LIMITATION_FITTED,
    LIMITATION_NOTHING_ABSORBED,
    LIMITATION_SUPPLIED,
)

pytestmark = pytest.mark.trace(flow="analysis.deterministic-studies", category="functionality")

CHECKSUM = "0123456789abcdef" * 4

# Three pixels of the drawn scenes' width: the classification blur can move a crossing by one or
# two, depending on where in the gap between two bands the fitted threshold lands.
POSITION_TOLERANCE = 3 / scenes.WIDTH


def _plates(image: np.ndarray, **parameters: object) -> PlateSuite:
    """Plates at three values unless a test says otherwise.

    The drawn scenes are built from three bands, so three values is what makes their answers
    exact. The tool's own default is five, and that is pinned on its own below.
    """
    return make_plates(
        image,
        source_checksum=CHECKSUM,
        parameters=PlateParameters(**{"levels": 3, **parameters}),
    )


def _only_contour_strength(image: np.ndarray) -> list[float]:
    (contour,) = _plates(image, levels=2, thresholds=(50.0,)).outline.contours
    return contour.edge_strength


# --- The value map ---------------------------------------------------------------------------


def test_the_default_is_five_values() -> None:
    values = make_plates(scenes.ramp(), source_checksum=CHECKSUM).values

    assert PlateParameters().levels == 5
    assert len(values.thresholds) == 4


def test_fitted_thresholds_fall_between_the_bands() -> None:
    values = _plates(scenes.three_bands()).values
    dark_to_middle, middle_to_light = values.thresholds

    assert scenes.BAND_LIGHTNESS[0] < dark_to_middle < scenes.BAND_LIGHTNESS[1]
    assert scenes.BAND_LIGHTNESS[1] < middle_to_light < scenes.BAND_LIGHTNESS[2]
    assert values.shares == pytest.approx((1 / 3, 1 / 3, 1 / 3), abs=0.01)
    assert LIMITATION_FITTED in values.metadata.limitations


def test_each_band_is_one_value() -> None:
    labels = _plates(scenes.three_bands()).values.labels

    for index in range(3):
        inside = labels[:, index * scenes.BAND_WIDTH + 5 : (index + 1) * scenes.BAND_WIDTH - 5]
        assert (inside == index).all()


def test_supplied_thresholds_are_used_and_marked_a_choice() -> None:
    values = _plates(scenes.three_bands(), thresholds=(35.0, 65.0)).values

    assert values.thresholds == (35.0, 65.0)
    assert LIMITATION_SUPPLIED in values.metadata.limitations
    assert LIMITATION_FITTED not in values.metadata.limitations


def test_value_tones_are_evenly_spaced_lightness() -> None:
    image = _plates(scenes.three_bands()).values.image
    centres = [(index * scenes.BAND_WIDTH) + scenes.BAND_WIDTH // 2 for index in range(3)]

    tones = [int(image[scenes.HEIGHT // 2, col]) for col in centres]
    assert tones == [scenes.grey_for(0.0), scenes.grey_for(50.0), scenes.grey_for(100.0)]


@pytest.mark.parametrize("levels", [5, 10])
def test_more_levels_divide_more_finely(levels: int) -> None:
    values = _plates(scenes.ramp(), levels=levels).values

    assert len(values.thresholds) == levels - 1
    assert list(values.thresholds) == sorted(set(values.thresholds))
    assert set(np.unique(values.labels).tolist()) == set(range(levels))


def test_detail_presets_are_three_five_seven_and_ten() -> None:
    assert DETAIL_LEVELS == {"coarse": 3, "medium": 5, "fine": 7, "finest": 10}
    assert PlateParameters.for_detail("finest").levels == 10


def test_an_absent_value_is_stated_not_hidden() -> None:
    flat = np.full((scenes.HEIGHT, scenes.WIDTH), scenes.grey_for(50.0), dtype=np.uint8)
    plates = _plates(flat)

    assert 0.0 in plates.values.shares
    assert LIMITATION_EMPTY_VALUE in plates.values.metadata.limitations
    assert plates.outline.contours == []


def test_a_speck_below_min_region_is_absorbed() -> None:
    plates = _plates(scenes.speckled_bands())
    row, col = scenes.SPECK_CENTRE

    assert plates.values.labels[row, col] == 0
    assert not any(contour.closed for contour in plates.outline.contours)


def test_min_region_zero_keeps_the_speck() -> None:
    plates = _plates(scenes.speckled_bands(), min_region=0.0)
    row, col = scenes.SPECK_CENTRE

    assert plates.values.labels[row, col] == 2
    assert any(contour.closed for contour in plates.outline.contours)
    # Nothing was absorbed, so nothing is claimed absorbed.
    assert not any(
        text.startswith("Value regions smaller") for text in plates.values.metadata.limitations
    )


def test_when_no_region_is_large_enough_nothing_is_claimed_absorbed() -> None:
    """With every region below `min_region` there is nothing to absorb into: keep it, say so."""
    values = _plates(
        scenes.checkerboard(), levels=2, thresholds=(50.0,), smoothing=0.0, min_region=0.05
    ).values

    assert set(np.unique(values.labels).tolist()) == {0, 1}
    assert LIMITATION_NOTHING_ABSORBED in values.metadata.limitations
    assert not any(text.startswith("Value regions smaller") for text in values.metadata.limitations)


# --- The grayscale plate ---------------------------------------------------------------------


def test_grayscale_keeps_lightness_and_drops_colour() -> None:
    image = _plates(scenes.colour_and_its_grey()).grayscale.image
    red_side = image[:, 10 : scenes.WIDTH // 2 - 10]
    grey_side = image[:, scenes.WIDTH // 2 + 10 : -10]

    assert image.ndim == 2
    assert abs(int(np.median(red_side)) - int(np.median(grey_side))) <= 1


# --- The outline -----------------------------------------------------------------------------


def test_outline_lies_on_the_band_boundaries() -> None:
    contours = _plates(scenes.three_bands()).outline.contours

    assert sorted(contour.level for contour in contours) == [1, 2]
    for contour in contours:
        boundary_x = contour.level * scenes.BAND_WIDTH / scenes.WIDTH
        for point in contour.points:
            assert point.x == pytest.approx(boundary_x, abs=POSITION_TOLERANCE)


def test_a_contour_meeting_the_frame_is_open_and_reaches_it() -> None:
    """The frame is not a value edge: a region that runs off the photograph stays open."""
    for contour in _plates(scenes.three_bands()).outline.contours:
        assert not contour.closed
        top, bottom = sorted((contour.points[0].y, contour.points[-1].y))
        assert top == pytest.approx(0.5 / scenes.HEIGHT)
        assert bottom == pytest.approx((scenes.HEIGHT - 0.5) / scenes.HEIGHT)
        assert len(contour.edge_strength) == len(contour.points) - 1


def test_a_contour_clear_of_the_frame_is_closed() -> None:
    (contour,) = _plates(scenes.disc(), levels=2).outline.contours
    cols = np.array([point.x * scenes.WIDTH for point in contour.points])
    rows = np.array([point.y * scenes.HEIGHT for point in contour.points])
    radii = np.hypot(cols - scenes.WIDTH / 2, rows - scenes.HEIGHT / 2)

    assert contour.closed
    assert contour.level == 1
    assert radii.mean() == pytest.approx(scenes.DISC_RADIUS, abs=2.0)
    assert len(contour.edge_strength) == len(contour.points)


@pytest.mark.parametrize(
    "scene", [scenes.three_bands, scenes.speckled_bands, scenes.disc, scenes.ramp]
)
@pytest.mark.parametrize("levels", [2, 3, 5, 10])
def test_every_contour_point_lies_on_an_edge_of_the_value_map(scene, levels: int) -> None:
    plates = _plates(scene(), levels=levels, min_region=0.0)

    assert plates.outline.contours
    for contour in plates.outline.contours:
        assert scenes.off_boundary_points(plates.values.labels, contour) == []


# --- Edge measurement ------------------------------------------------------------------------


def test_a_hard_edge_measures_strong() -> None:
    assert min(_only_contour_strength(scenes.step())) > 0.95


def test_a_soft_edge_measures_weaker() -> None:
    """Blurred over 5% of the width: clearly an edge, clearly not a hard one."""
    strength = _only_contour_strength(scenes.step(softness=0.05))

    assert all(0.2 < value < 0.6 for value in strength)


def test_a_ramp_crossing_is_not_an_edge() -> None:
    """The threshold alone puts a line through a smooth ramp; the measurement must say so."""
    assert max(_only_contour_strength(scenes.ramp())) <= 0.05


# --- The recipe ------------------------------------------------------------------------------


def test_the_recipe_reproduces_every_plate() -> None:
    first, second = _plates(scenes.disc()), _plates(scenes.disc())

    assert np.array_equal(first.grayscale.image, second.grayscale.image)
    assert np.array_equal(first.values.labels, second.values.labels)
    assert [contour.model_dump() for contour in first.outline.contours] == [
        contour.model_dump() for contour in second.outline.contours
    ]


def test_each_plate_carries_its_own_metadata() -> None:
    params = PlateParameters(levels=5)
    plates = make_plates(scenes.three_bands(), source_checksum=CHECKSUM, parameters=params)
    metadata = [plates.grayscale.metadata, plates.values.metadata, plates.outline.metadata]

    assert [entry.tool for entry in metadata] == ["grayscale", "value_map", "outline"]
    for entry in metadata:
        assert entry.tool_version == f"2+opencv-{cv2.__version__}.numpy-{np.__version__}"
        assert entry.parameters == params.model_dump()
        assert entry.source_checksum == CHECKSUM
        # Deterministic plates have no confidence to state; `None`, not 0.0.
        assert entry.confidence is None
    durations = [entry.duration_ms for entry in metadata]
    assert durations == sorted(durations)


def test_large_images_are_worked_at_the_working_size() -> None:
    large = cv2.resize(scenes.three_bands(), (2048, 1024), interpolation=cv2.INTER_NEAREST)
    plates = _plates(large)

    assert plates.grayscale.image.shape == (512, 1024)
    assert plates.values.labels.shape == (512, 1024)


def test_small_images_are_never_upscaled() -> None:
    image = _plates(scenes.three_bands()).grayscale.image

    assert image.shape == (scenes.HEIGHT, scenes.WIDTH)


# --- Refusals --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "parameters",
    [
        {"levels": 3, "thresholds": (50.0,)},
        {"levels": 3, "thresholds": (60.0, 40.0)},
        {"levels": 3, "thresholds": (40.0, 40.0)},
        {"levels": 2, "thresholds": (0.0,)},
        {"levels": 2, "thresholds": (100.0,)},
        {"levels": 1},
        {"levels": 11},
        {"colour": True},
    ],
)
def test_invalid_parameters_are_refused(parameters: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        PlateParameters(**parameters)


@pytest.mark.parametrize(
    "image",
    [np.zeros((10, 10), dtype=np.float32), np.zeros((10, 10, 4), dtype=np.uint8)],
)
def test_unsupported_images_are_refused(image: np.ndarray) -> None:
    with pytest.raises(ValueError, match="expected"):
        make_plates(image, source_checksum=CHECKSUM)
