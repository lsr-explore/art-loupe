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

    assert plates.outline.contours
    for contour in plates.outline.contours:
        assert scenes.off_boundary_points(plates.values.labels, contour) == []
