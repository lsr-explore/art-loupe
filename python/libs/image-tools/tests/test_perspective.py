"""The perspective tool: where it puts the points, and whether its confidence means anything.

Accuracy is asserted only against drawn scenes whose vanishing points are exact — the slice
does not tune or validate against photographs. What *is* asserted hard is that the confidence
responds to the evidence: fewer lines, looser convergence, and clutter each lower it, and
each through the signal that should catch it. A confidence that did not move would still pass
every accuracy test, and would make the FR-402 interrupt fire at random.
"""

import cv2
import numpy as np
import perspective_scenes as scenes
import pytest
from pydantic import ValidationError

from artloupe.image_tools import (
    PerspectiveParameters,
    PerspectiveResult,
    VanishingPointConfidence,
    detect_perspective,
)
from artloupe.image_tools.perspective import (
    LIMITATION_LEVEL_HORIZON,
    LIMITATION_NONE_FOUND,
    LIMITATION_NOT_VALIDATED,
)

pytestmark = pytest.mark.trace(flow="analysis.geometry", category="functionality")

CHECKSUM = "0123456789abcdef" * 4

# Drawn scenes are recovered to within 0.003 in practice; this leaves room for LSD to move
# between OpenCV releases without letting a real regression through.
POSITION_TOLERANCE = 0.01


def _detect(image: np.ndarray, **parameters: object) -> PerspectiveResult:
    """Detect with the reporting floor off unless a test sets it.

    Most tests here examine the candidates themselves — phantoms, sparse and loose families —
    which sit below any sensible floor by design. The floor has its own tests at the end.
    """
    return detect_perspective(
        image,
        source_checksum=CHECKSUM,
        parameters=PerspectiveParameters(**{"min_confidence": 0.0, **parameters}),
    )


def _points(result: PerspectiveResult) -> list[tuple[float, float]]:
    return [(vp.point.x, vp.point.y) for vp in result.vanishing_points]


def _assert_near(actual: list[tuple[float, float]], expected: list[tuple[float, float]]) -> None:
    assert len(actual) == len(expected), f"found {actual}, expected {expected}"
    for (actual_x, actual_y), (expected_x, expected_y) in zip(actual, expected, strict=True):
        assert actual_x == pytest.approx(expected_x, abs=POSITION_TOLERANCE)
        assert actual_y == pytest.approx(expected_y, abs=POSITION_TOLERANCE)


# --- Where the points land -------------------------------------------------------------------


def test_two_point_scene_finds_both_points_off_frame_and_unclamped() -> None:
    """The ordinary two-point case: both points outside the photograph, reported there.

    Clamping either into `[0, 1]` would report a different point — the overlay's inability to
    show one there is issue #40, not a reason to move it.
    """
    scene = scenes.two_point()
    result = _detect(scene.image)

    _assert_near(_points(result), scene.vanishing_points)
    left, right = result.vanishing_points
    assert left.point.x < 0.0
    assert right.point.x > 1.0


def test_two_point_horizon_is_measured_through_both_points() -> None:
    scene = scenes.two_point()
    horizon = _detect(scene.image).horizon

    assert horizon is not None
    assert horizon.left.x == pytest.approx(0.0)
    assert horizon.right.x == pytest.approx(1.0)
    assert horizon.left.y == pytest.approx(scene.horizon_y, abs=POSITION_TOLERANCE)
    assert horizon.right.y == pytest.approx(scene.horizon_y, abs=POSITION_TOLERANCE)
    assert horizon.level_assumed is False


def test_verticals_and_parallels_are_not_reported_as_vanishing_points() -> None:
    """The two-point scene's uprights and the one-point scene's horizontals are line families
    too, and RANSAC finds them. Neither is a point on the horizon."""
    assert len(_detect(scenes.two_point().image).vanishing_points) == 2
    assert len(_detect(scenes.one_point().image).vanishing_points) == 1


def test_one_point_horizon_is_level_and_says_it_was_assumed() -> None:
    """With one point, the horizon's tilt is not measured. The result must say so, or an
    agent will cite a level horizon as a measured fact."""
    scene = scenes.one_point()
    result = _detect(scene.image)

    _assert_near(_points(result), scene.vanishing_points)
    assert result.horizon is not None
    assert result.horizon.level_assumed is True
    assert result.horizon.left.y == result.horizon.right.y
    assert LIMITATION_LEVEL_HORIZON in result.metadata.limitations


def test_portrait_orientation_converts_through_the_other_axis() -> None:
    """Normalized space is anisotropic; a tall image catches a conversion that only works
    when width is the long edge."""
    scene = scenes.two_point(width=900, height=1200)
    _assert_near(_points(_detect(scene.image)), scene.vanishing_points)


def test_output_does_not_depend_on_the_working_resolution() -> None:
    scene = scenes.two_point()
    downscaled = _points(_detect(scene.image, working_long_edge_px=768))
    full_size = _points(_detect(scene.image, working_long_edge_px=2048))
    _assert_near(downscaled, full_size)


def test_bgr_input_matches_grayscale() -> None:
    scene = scenes.two_point()
    colour = cv2.cvtColor(scene.image, cv2.COLOR_GRAY2BGR)
    assert _points(_detect(colour)) == _points(_detect(scene.image))


# --- Whether the confidence means anything ---------------------------------------------------


def test_confidence_is_the_weakest_signal_and_names_it() -> None:
    confidence = VanishingPointConfidence(
        significance=0.9,
        angular_fit=0.4,
        support=0.7,
        supporting_segments=8,
        chance_multiple=18.0,
        mean_residual_deg=0.9,
    )
    assert confidence.value == 0.4
    assert confidence.weakest == "angular_fit"


def test_a_clean_scene_is_confident() -> None:
    result = _detect(scenes.two_point().image)
    assert all(vp.confidence.value > 0.85 for vp in result.vanishing_points)


def test_few_supporting_lines_lower_confidence_through_support() -> None:
    clean = _detect(scenes.single_family(12).image).vanishing_points
    sparse = _detect(scenes.single_family(2).image).vanishing_points

    assert len(clean) == len(sparse) == 1
    assert sparse[0].confidence.weakest == "support"
    assert sparse[0].confidence.value < clean[0].confidence.value
    assert sparse[0].confidence.value <= 0.5


def test_loose_convergence_lowers_confidence_through_angular_fit() -> None:
    fits = [
        _detect(scenes.single_family(12, jitter_deg=jitter).image).vanishing_points[0].confidence
        for jitter in (0.0, 0.5, 1.0)
    ]
    assert [fit.weakest for fit in fits] == ["angular_fit"] * 3
    assert fits[0].angular_fit > fits[1].angular_fit > fits[2].angular_fit


def test_clutter_alone_scores_far_below_real_structure() -> None:
    """Randomly oriented segments converge *somewhere* by chance, and RANSAC will find it.

    With absolute support alone these phantoms scored up to 0.74 — level with a real one-point
    scene. `significance` is what separates them: support only counts above what chance puts
    at any point. This pins a wide gap, not merely an ordering, because PR 13's threshold has
    to fit inside it with room to spare.
    """
    real = [
        vp.confidence.value
        for image in (scenes.two_point().image, scenes.one_point().image)
        for vp in _detect(image).vanishing_points
    ]
    phantoms = [
        vp.confidence
        for seed in range(1, 6)
        for vp in _detect(scenes.single_family(0, clutter=150, seed=seed).image).vanishing_points
    ]
    assert phantoms, "clutter produced no phantom families, so this test proved nothing"
    assert all(phantom.weakest == "significance" for phantom in phantoms)
    assert max(phantom.value for phantom in phantoms) < 0.35
    assert min(real) > 0.7


def test_a_phantom_beside_real_structure_is_the_one_flagged() -> None:
    """Clutter around a real family: both are reported, and the phantom is the one flagged.

    Pinned as an ordering, deliberately not against a fixed bound. A phantom beside real
    structure reaches ~0.54 here, while the real convergence in the Murano canal photograph
    scores 0.42 — so no single threshold separates phantoms from real points on photographs,
    and a bound asserted here would be a threshold chosen on drawn scenes. That is PR 13's
    call, made against photographs.

    The real point is picked out by proximity rather than `POSITION_TOLERANCE` — clutter pulls
    it slightly, and this test is about which point is flagged, not how precisely it lands.
    """
    scene = scenes.single_family(12, clutter=40)
    ((truth_x, truth_y),) = scene.vanishing_points
    real, phantom = sorted(
        _detect(scene.image).vanishing_points,
        key=lambda vp: (vp.point.x - truth_x) ** 2 + (vp.point.y - truth_y) ** 2,
    )
    assert real.point.x == pytest.approx(truth_x, abs=0.05)
    assert phantom.confidence.weakest == "significance"
    assert phantom.confidence.value < real.confidence.value


def test_nothing_found_is_zero_confidence_not_none() -> None:
    """`None` would say confidence does not apply to this tool. It does; there is none."""
    for image in (scenes.blank(), scenes.noise()):
        result = _detect(image)
        assert result.vanishing_points == []
        assert result.horizon is None
        assert result.metadata.confidence == 0.0
        assert LIMITATION_NONE_FOUND in result.metadata.limitations


def test_artifact_confidence_is_its_weakest_feature() -> None:
    result = _detect(scenes.single_family(12, clutter=40).image)
    assert result.metadata.confidence == min(vp.confidence.value for vp in result.vanishing_points)
    assert result.horizon is not None
    assert result.horizon.confidence == result.metadata.confidence


def test_search_effort_does_not_buy_phantom_confidence() -> None:
    """More RANSAC hypotheses must not make clutter look more significant.

    `significance` compares support with chance agreement at *one* point, while RANSAC keeps
    the best of many — so a longer search could, in principle, inflate it. Measured, it does
    not: across 200-20,000 hypotheses phantom confidence stays at 0.21-0.23, because hypotheses
    are drawn from segment pairs and the reachable points saturate early. The selection bias
    is a constant floor (phantoms sit near 4× chance, not 1×) that `FULL_SIGNIFICANCE_MULTIPLE`
    is calibrated over. This pins that it stays constant.
    """

    def phantom_ceiling(hypotheses: int) -> float:
        return max(
            vp.confidence.value
            for seed in range(1, 4)
            for vp in _detect(
                scenes.single_family(0, clutter=150, seed=seed).image, hypotheses=hypotheses
            ).vanishing_points
        )

    assert phantom_ceiling(8000) == pytest.approx(phantom_ceiling(500), abs=0.05)


# --- The FR-305 recipe -----------------------------------------------------------------------


def test_metadata_records_the_recipe() -> None:
    parameters = PerspectiveParameters(seed=11, hypotheses=500)
    result = detect_perspective(
        scenes.two_point().image, source_checksum=CHECKSUM, parameters=parameters
    )

    assert result.metadata.tool == "perspective"
    assert result.metadata.tool_version == (f"2+opencv-{cv2.__version__}.numpy-{np.__version__}")
    assert result.metadata.parameters == parameters.model_dump()
    assert result.metadata.source_checksum == CHECKSUM
    assert result.metadata.duration_ms >= 0
    assert LIMITATION_NOT_VALIDATED in result.metadata.limitations


# --- The evidence behind each point ----------------------------------------------------------


def test_each_point_carries_the_segments_that_converge_on_it() -> None:
    """Every reported segment points at its vanishing point, within the inlier threshold."""
    scene = scenes.two_point()
    height, width = scene.image.shape[:2]
    parameters = PerspectiveParameters()

    for vp in _detect(scene.image).vanishing_points:
        assert len(vp.segments) == vp.confidence.supporting_segments
        target = np.array([vp.point.x * width, vp.point.y * height])
        for segment in vp.segments:
            start = np.array([segment.start.x * width, segment.start.y * height])
            end = np.array([segment.end.x * width, segment.end.y * height])
            along = (end - start) / np.linalg.norm(end - start)
            towards = target - (start + end) / 2
            towards /= np.linalg.norm(towards)
            residual = np.degrees(np.arcsin(abs(along[0] * towards[1] - along[1] * towards[0])))
            assert residual <= parameters.inlier_threshold_deg + 0.1


# --- The reporting floor ---------------------------------------------------------------------


def test_the_floor_defaults_to_the_agreed_value() -> None:
    assert PerspectiveParameters().min_confidence == 0.35


def test_the_floor_holds_clutter_back_and_says_so() -> None:
    """Clutter's chance convergences score below the floor: held back, and counted, not lost."""
    tested = 0
    for seed in range(1, 6):
        clutter = scenes.single_family(0, clutter=150, seed=seed).image
        if not _detect(clutter).vanishing_points:
            continue
        tested += 1
        held = detect_perspective(clutter, source_checksum=CHECKSUM)
        assert held.vanishing_points == []
        assert held.metadata.confidence == 0.0
        assert any(
            "below the reporting floor of 0.35" in text for text in held.metadata.limitations
        )
        # Candidates existed, so "nothing found" would be false.
        assert LIMITATION_NONE_FOUND not in held.metadata.limitations
    assert tested, "clutter produced no candidates, so this test proved nothing"


def test_the_floor_keeps_real_structure() -> None:
    result = detect_perspective(scenes.two_point().image, source_checksum=CHECKSUM)

    assert len(result.vanishing_points) == 2
    assert not any("reporting floor" in text for text in result.metadata.limitations)


def test_the_floor_is_recorded_and_can_be_switched_off() -> None:
    clutter = scenes.single_family(0, clutter=150, seed=1).image
    parameters = PerspectiveParameters(min_confidence=0.0)
    result = detect_perspective(clutter, source_checksum=CHECKSUM, parameters=parameters)

    assert result.metadata.parameters["min_confidence"] == 0.0
    assert result.vanishing_points == _detect(clutter).vanishing_points


def test_the_same_recipe_reproduces_the_same_result() -> None:
    """Slice 1 stores the recipe, not the artifact, so a rerun must produce the same answer."""
    image = scenes.single_family(12, clutter=40).image
    first, second = _detect(image), _detect(image)
    assert first.model_dump(exclude={"metadata": {"duration_ms"}}) == second.model_dump(
        exclude={"metadata": {"duration_ms"}}
    )


def test_a_result_reloads_from_json_exactly() -> None:
    """A stored result is reloaded, never recomputed.

    The confidence's `weakest` and `value` are computed fields, written to JSON for readers; on
    reload they are dropped and derived again. Before that, `extra="forbid"` rejected them and no
    stored perspective result could be read back at all.
    """
    result = _detect(scenes.two_point().image)

    assert PerspectiveResult.model_validate_json(result.model_dump_json()) == result


def test_an_invalid_checksum_is_refused() -> None:
    with pytest.raises(ValidationError):
        detect_perspective(scenes.blank(), source_checksum="not-a-checksum")


def test_unknown_parameters_are_refused() -> None:
    with pytest.raises(ValidationError):
        PerspectiveParameters(threshold=3)  # type: ignore[call-arg]


@pytest.mark.parametrize(
    "image",
    [
        np.zeros((64, 64), dtype=np.float32),
        np.zeros((64, 64, 4), dtype=np.uint8),
    ],
    ids=["float-image", "four-channel"],
)
def test_unsupported_images_are_refused(image: np.ndarray) -> None:
    with pytest.raises(ValueError):
        detect_perspective(image, source_checksum=CHECKSUM)
