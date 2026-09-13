"""The plate suite on the two walkthrough photographs.

**This pins behaviour; it does not validate accuracy.** The one behaviour a wrong default would
break shows only on a photograph: the portrait is low-key, and a threshold rule that divides by
area rather than by the histogram's gaps turns its black ground into three "values". When the
default was chosen, equal-area thirds put the portrait's thresholds at L* 4 and 5; multi-level
Otsu keeps 87% of it dark and still separates the face into planes.

Provenance and licence for both files: `docs/media-assets.md`.
"""

from pathlib import Path

import cv2
import numpy as np
import plate_scenes as scenes
import pytest

from artloupe.image_tools import PlateParameters, PlateSuite, make_plates
from artloupe.image_tools.plates import LIMITATION_LOW_CONTRAST

pytestmark = pytest.mark.trace(flow="analysis.deterministic-studies", category="functionality")

DEMO_IMAGES = Path(__file__).resolve().parents[4] / "fixtures" / "demo-images"
CANAL = DEMO_IMAGES / "pexels-dalia-nava-167975-7954434.jpg"
PORTRAIT = DEMO_IMAGES / "pexels-tim-diercks-719708976-31589335.jpg"
CANAL_CHECKSUM = "003fde582efcce54da2cf0793c0e594686506e8897de47efa44113cf5723ae8c"
PORTRAIT_CHECKSUM = "8fe9582f197a30ad9ee4b3c7ee1bfff2a0af40ab6578d04482c391659ba22b72"


def _plates(path: Path, checksum: str, levels: int = 3) -> PlateSuite:
    # `imread` applies EXIF orientation, which the tool requires of its caller.
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    assert isinstance(image, np.ndarray), f"could not decode {path}"
    return make_plates(image, source_checksum=checksum, parameters=PlateParameters(levels=levels))


def test_the_portrait_stays_low_key() -> None:
    dark, _middle, _light = _plates(PORTRAIT, PORTRAIT_CHECKSUM).values.shares

    assert dark >= 0.8


def test_the_portraits_face_still_separates_into_lighter_values() -> None:
    _dark, middle, light = _plates(PORTRAIT, PORTRAIT_CHECKSUM).values.shares

    assert middle >= 0.02
    assert light >= 0.02


@pytest.mark.parametrize(
    ("path", "checksum"), [(CANAL, CANAL_CHECKSUM), (PORTRAIT, PORTRAIT_CHECKSUM)]
)
@pytest.mark.parametrize("levels", [3, 5, 7])
def test_every_contour_traces_the_value_map(path: Path, checksum: str, levels: int) -> None:
    plates = _plates(path, checksum, levels)

    assert plates.value_shapes.contours
    for contour in plates.value_shapes.contours:
        assert scenes.off_boundary_points(plates.values.labels, contour) == []


# --- The outline, on photographs -------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "checksum"), [(CANAL, CANAL_CHECKSUM), (PORTRAIT, PORTRAIT_CHECKSUM)]
)
def test_a_photograph_yields_both_straight_runs_and_traced_ones(path: Path, checksum: str) -> None:
    """A photograph is not a drawing: it must exercise both halves of the fitter.

    All-straight would mean a scene of chords, all-traced would mean the fitter never fired, and
    either would make the straight/traced distinction decorative.
    """
    chains = _plates(path, checksum).outline.chains

    assert any(chain.straight for chain in chains)
    assert any(not chain.straight for chain in chains)


def test_the_canal_comes_back_mostly_straight() -> None:
    """The buildings are the reason the outline was rebuilt. They must fit as straight lines."""
    chains = _plates(CANAL, CANAL_CHECKSUM).outline.chains

    assert sum(chain.straight for chain in chains) / len(chains) > 0.4


def test_the_low_key_portrait_is_where_the_two_layers_diverge() -> None:
    """The outline thins out on a low-key photograph and the value shapes do not.

    This is the measured finding from `../tool-demo/observations.md` §9 held in place: the
    portrait's silhouette is a 2 L* step, invisible to an edge detector. The canal, lit normally,
    is the control — there the outline is the richer of the two.
    """
    canal = _plates(CANAL, CANAL_CHECKSUM)
    portrait = _plates(PORTRAIT, PORTRAIT_CHECKSUM)

    assert len(canal.outline.chains) > len(canal.value_shapes.contours)
    assert LIMITATION_LOW_CONTRAST in portrait.outline.metadata.limitations
    # The outline loses far more going from the lit scene to the low-key one than the value
    # shapes do, which is the whole argument for keeping both layers.
    outline_drop = len(portrait.outline.chains) / len(canal.outline.chains)
    shapes_drop = len(portrait.value_shapes.contours) / len(canal.value_shapes.contours)
    assert outline_drop < shapes_drop


def test_the_suite_stays_within_its_time_budget() -> None:
    """L0 smoothing took 8.6 s on the canal and 0.7 s on the portrait — no budget at all.

    The default filter's cost does not depend on the picture, which is why it is the default.
    Generous against NFR-01's 2 s so it fails on a regression, not on a slow machine.
    """
    for path, checksum in ((CANAL, CANAL_CHECKSUM), (PORTRAIT, PORTRAIT_CHECKSUM)):
        assert _plates(path, checksum).outline.metadata.duration_ms < 4000
