"""The plate suite: one pipeline, four plates, and edges measured honestly.

Unlike detection, a plate is right or wrong by construction: a value map divides the photograph
where its thresholds say, and value shapes trace the value map's own boundaries or they have
broken. So these assert exactly, on drawn scenes. The correspondence is asserted hardest — every
contour point sits on an edge of the value map — because it is the guarantee the one-pipeline
design exists to give, and an independent edge detector bolted on beside it would pass
everything else.

The outline is the other half and is asserted differently, because it is allowed to miss things.
What is pinned is that it misses the *right* things and says so: a straight edge comes back as a
straight run rather than a trace, and a 2 L* silhouette comes back not at all while the
value-shapes plate in the same suite still carries it. That pair is the reason both layers ship.
"""

import math

import cv2
import numpy as np
import plate_scenes as scenes
import pytest
from pydantic import ValidationError

from artloupe.image_tools import DETAIL_LEVELS, PlateParameters, PlateSuite, make_plates
from artloupe.image_tools.plates import (
    LIMITATION_EMPTY_VALUE,
    LIMITATION_FITTED,
    LIMITATION_LOW_CONTRAST,
    LIMITATION_NOTHING_ABSORBED,
    LIMITATION_SHADOW_PASS,
    LIMITATION_STRAIGHTENED,
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
    (contour,) = _plates(image, levels=2, thresholds=(50.0,)).value_shapes.contours
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
    assert plates.value_shapes.contours == []


def test_a_speck_below_min_region_is_absorbed() -> None:
    plates = _plates(scenes.speckled_bands())
    row, col = scenes.SPECK_CENTRE

    assert plates.values.labels[row, col] == 0
    assert not any(contour.closed for contour in plates.value_shapes.contours)


def test_min_region_zero_keeps_the_speck() -> None:
    plates = _plates(scenes.speckled_bands(), min_region=0.0)
    row, col = scenes.SPECK_CENTRE

    assert plates.values.labels[row, col] == 2
    assert any(contour.closed for contour in plates.value_shapes.contours)
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


# --- Value shapes ----------------------------------------------------------------------------


def test_value_shapes_lie_on_the_band_boundaries() -> None:
    contours = _plates(scenes.three_bands()).value_shapes.contours

    assert sorted(contour.level for contour in contours) == [1, 2]
    for contour in contours:
        boundary_x = contour.level * scenes.BAND_WIDTH / scenes.WIDTH
        for point in contour.points:
            assert point.x == pytest.approx(boundary_x, abs=POSITION_TOLERANCE)


def test_a_contour_meeting_the_frame_is_open_and_reaches_it() -> None:
    """The frame is not a value edge: a region that runs off the photograph stays open."""
    for contour in _plates(scenes.three_bands()).value_shapes.contours:
        assert not contour.closed
        top, bottom = sorted((contour.points[0].y, contour.points[-1].y))
        assert top == pytest.approx(0.5 / scenes.HEIGHT)
        assert bottom == pytest.approx((scenes.HEIGHT - 0.5) / scenes.HEIGHT)
        assert len(contour.edge_strength) == len(contour.points) - 1


def test_a_contour_clear_of_the_frame_is_closed() -> None:
    (contour,) = _plates(scenes.disc(), levels=2).value_shapes.contours
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

    assert plates.value_shapes.contours
    for contour in plates.value_shapes.contours:
        assert scenes.off_boundary_points(plates.values.labels, contour) == []


# --- The outline -----------------------------------------------------------------------------


def test_a_straight_edge_is_reported_as_a_straight_run() -> None:
    """A drawn rectangle's sides are straight, so the outline claims them rather than tracing."""
    chains = _plates(scenes.straight_and_curved()).outline.chains
    straight = [chain for chain in chains if chain.straight]

    assert straight
    for chain in straight:
        # A straight run is a claim about geometry: two points, and the ends of a fitted line.
        assert len(chain.points) == 2


def test_a_tightly_curved_edge_is_traced_rather_than_straightened() -> None:
    """The disc turns faster than a chord can follow, so it must come back traced.

    Only a tight curve pins this. A large circle is legitimately chorded — see `TIGHT_RADIUS`.
    """
    chains = _plates(scenes.straight_and_curved()).outline.chains
    around_the_disc = [chain for chain in chains if all(point.x > 0.5 for point in chain.points)]

    assert around_the_disc
    assert all(not chain.straight for chain in around_the_disc)
    assert any(len(chain.points) > 2 for chain in around_the_disc)


def test_straightening_is_declared_when_it_happened() -> None:
    plates = _plates(scenes.straight_and_curved())

    assert any(chain.straight for chain in plates.outline.chains)
    assert LIMITATION_STRAIGHTENED in plates.outline.metadata.limitations


def test_the_outline_cannot_see_a_two_lightness_step_and_says_so() -> None:
    """The finding the two-layer design exists for, pinned as a test.

    An edge detector needs a gradient. At the demo portrait's measured lightnesses — ground
    L* 3.5, subject L* 5.4 — there is none to find, and the outline comes back empty over the
    subject's edges. The value map's thresholds are fitted to the histogram, so the same suite
    still carries the silhouette. If this test ever starts failing because the outline found the
    box, the limitation it asserts is no longer true and must be rewritten, not deleted.
    """
    plates = _plates(scenes.low_contrast_subject(), levels=2)
    left, top, width, height = scenes.LOW_CONTRAST_BOX
    edges = {
        "left": left / scenes.WIDTH,
        "right": (left + width) / scenes.WIDTH,
    }

    # The value map found the subject: it is one of exactly two values, and it is traced.
    assert plates.value_shapes.contours
    traced_x = {
        round(point.x, 2) for contour in plates.value_shapes.contours for point in contour.points
    }
    assert any(abs(found - edges["left"]) < 0.02 for found in traced_x)

    # The outline did not, anywhere near either vertical edge of the box.
    outline_x = [point.x for chain in plates.outline.chains for point in chain.points]
    for edge in edges.values():
        assert not any(abs(found - edge) < 0.02 for found in outline_x)
    assert LIMITATION_LOW_CONTRAST in plates.outline.metadata.limitations


def test_the_shadow_pass_is_off_at_gamma_one_and_declared_when_it_runs() -> None:
    scene = scenes.straight_and_curved()

    off = _plates(scene, shadow_gamma=1.0).outline
    assert not any(chain.from_shadow_pass for chain in off.chains)
    assert LIMITATION_SHADOW_PASS not in off.metadata.limitations

    # The default runs the pass; whether it recovers anything on a given scene is the scene's
    # business, but the claim and the flag must agree with each other.
    on = _plates(scene).outline
    recovered = [chain for chain in on.chains if chain.from_shadow_pass]
    assert (LIMITATION_SHADOW_PASS in on.metadata.limitations) == bool(recovered)


def test_a_scrap_shorter_than_min_chain_is_dropped() -> None:
    """`min_chain` is the scrap filter: raise it and short chains go, long ones stay."""
    scene = scenes.straight_and_curved()
    kept = _plates(scene, min_chain=0.0).outline.chains
    pruned = _plates(scene, min_chain=0.2).outline.chains

    assert len(pruned) < len(kept)


def test_min_chain_filters_fitted_lines_too() -> None:
    """The floor is on a chain, and a fitted straight run is a whole chain.

    It reached only traced chains once, so raising `min_chain` pruned one half of the outline
    while Edge Drawing's own 20 px minimum went on emitting short straight scraps.
    """
    plates = _plates(scenes.straight_and_curved(), min_chain=0.2)
    floor = 0.2 * math.hypot(scenes.HEIGHT, scenes.WIDTH)

    for chain in plates.outline.chains:
        if not chain.straight:
            continue
        (start, end) = chain.points
        length = math.hypot((end.x - start.x) * scenes.WIDTH, (end.y - start.y) * scenes.HEIGHT)
        # A pixel of slack: the points are stored normalized and round back to the pixel grid.
        assert length >= floor - 1.0


def test_dropping_a_fitted_line_yields_its_stretch_back_to_the_trace() -> None:
    """Raising `min_chain` must simplify the outline, never delete geometry from it.

    A fitted line tells the traced chains "this stretch is already drawn as a straight line". If
    the stencil is built before `min_chain` filters, a line dropped from the output still erases
    the edge underneath, so raising the floor deletes the edge rather than the line.

    The disc is the case that exposes it: at radius 75 the fitter covers it with sixteen chords
    of about 29 px, and a floor above that drops every one. What must survive is the disc — as
    the traced loop it always was, carrying essentially its whole circumference.
    """
    circumference = 2 * math.pi * scenes.DISC_RADIUS
    floor = 0.06  # 40 px here: above the chords, far below the loop

    chorded = _plates(scenes.disc(), levels=2, min_chain=0.0).outline.chains
    assert all(chain.straight for chain in chorded), "expected the disc to be chorded"

    chains = _plates(scenes.disc(), levels=2, min_chain=floor).outline.chains
    assert chains
    assert not any(chain.straight for chain in chains)

    drawn = 0.0
    for chain in chains:
        points = [(point.x * scenes.WIDTH, point.y * scenes.HEIGHT) for point in chain.points]
        walk = [*points, points[0]] if chain.closed else points
        drawn += sum(
            math.hypot(nxt[0] - here[0], nxt[1] - here[1])
            for here, nxt in zip(walk, walk[1:], strict=False)
        )

    assert drawn > 0.9 * circumference


def test_a_closed_loop_is_reported_closed() -> None:
    """Edge Drawing walks a loop without repeating its first point.

    Testing endpoints for equality therefore marked every loop open — on the demo photographs
    not one chain of 822 came back closed — and a consumer drawing only the stored segments
    leaves a gap where the ends meet. Closure is proximity.
    """
    chains = _plates(scenes.straight_and_curved()).outline.chains
    around_the_disc = [chain for chain in chains if all(point.x > 0.5 for point in chain.points)]

    assert around_the_disc
    assert any(chain.closed for chain in around_the_disc)
    for chain in around_the_disc:
        if chain.closed:
            # A closed chain measures one segment per point, the last joining back to the first.
            assert len(chain.edge_strength) == len(chain.points)


def test_a_fitted_line_measures_along_its_length_not_at_its_ends() -> None:
    """`edge_gradient` promises a median along the edge, so two endpoint samples will not do.

    A fitted line once passed only its two endpoints as the run to measure, and an endpoint sits
    disproportionately at a junction or a weak termination — the least representative part of the
    edge. The scene blurs the step's two ends, so sampling only them reports it softer than it is.

    The threshold sits between the two measurements, not near either: endpoints-only gives about
    `SOFT_END_ENDPOINT_STRENGTH`, along-the-line about `SOFT_END_ALONG_STRENGTH`. That margin is
    narrow and the scene is tuned to produce it — see the note in `plate_scenes`.
    """
    straight = [
        chain
        for chain in _plates(
            scenes.step_with_soft_ends(), levels=2, thresholds=(50.0,)
        ).outline.chains
        if chain.straight
    ]
    assert straight
    # The longest run is the one spanning the step, ends included.
    longest = max(
        straight,
        key=lambda chain: math.hypot(
            (chain.points[1].x - chain.points[0].x) * scenes.WIDTH,
            (chain.points[1].y - chain.points[0].y) * scenes.HEIGHT,
        ),
    )

    floor = (scenes.SOFT_END_ENDPOINT_STRENGTH + scenes.SOFT_END_ALONG_STRENGTH) / 2

    assert max(longest.edge_strength) > floor


def test_every_flatten_filter_produces_an_outline() -> None:
    for filter_name in ("domain_transform", "domain_transform_fast", "bilateral_texture", "none"):
        chains = _plates(scenes.straight_and_curved(), flatten=filter_name).outline.chains

        assert chains, f"{filter_name} produced no outline"


def test_edge_strength_is_measured_on_the_photograph_not_the_flattened_copy() -> None:
    """Flattening changes which edges are found; it must not change what they measure.

    The step is a hard edge whatever filter precedes the trace, so a strength that moved with the
    filter would be describing the filter. Compared on the value-shapes layer, which traces the
    same photograph under every one of them.
    """
    strengths = {
        name: max(
            max(contour.edge_strength)
            for contour in _plates(
                scenes.step(), levels=2, thresholds=(50.0,), flatten=name
            ).value_shapes.contours
        )
        for name in ("domain_transform", "bilateral_texture", "none")
    }

    assert len(set(strengths.values())) == 1


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
    assert [contour.model_dump() for contour in first.value_shapes.contours] == [
        contour.model_dump() for contour in second.value_shapes.contours
    ]
    assert [chain.model_dump() for chain in first.outline.chains] == [
        chain.model_dump() for chain in second.outline.chains
    ]


def test_each_plate_carries_its_own_metadata() -> None:
    params = PlateParameters(levels=5)
    plates = make_plates(scenes.three_bands(), source_checksum=CHECKSUM, parameters=params)
    metadata = [
        plates.grayscale.metadata,
        plates.values.metadata,
        plates.value_shapes.metadata,
        plates.outline.metadata,
    ]

    assert [entry.tool for entry in metadata] == [
        "grayscale",
        "value_map",
        "value_shapes",
        "outline",
    ]
    for entry in metadata:
        assert entry.tool_version == f"4+opencv-{cv2.__version__}.numpy-{np.__version__}"
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
