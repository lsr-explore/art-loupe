"""The perspective tool on the two walkthrough photographs.

**This pins behaviour; it does not validate accuracy.** Slice 1 does not tune against a gold
set, and one photograph per case is not one. What these tests catch is a *regression on the
demo's own inputs*: the canal's convergence on the bridge was once lost entirely — searched
families ran out on uprights and facades before reaching it — and only a photograph showed it,
because every drawn scene passed.

Positions are asserted loosely. LSD runs on real texture here, where a different OpenCV
build can move a segment by a pixel; the drawn scenes carry the tight tolerances.

Provenance and licence for both files: `docs/media-assets.md`.
"""

from pathlib import Path

import cv2
import numpy as np
import pytest

from artloupe.image_tools import PerspectiveResult, detect_perspective

pytestmark = pytest.mark.trace(flow="analysis.geometry", category="functionality")

DEMO_IMAGES = Path(__file__).resolve().parents[4] / "fixtures" / "demo-images"
CANAL = DEMO_IMAGES / "pexels-dalia-nava-167975-7954434.jpg"
PORTRAIT = DEMO_IMAGES / "pexels-tim-diercks-719708976-31589335.jpg"
CANAL_CHECKSUM = "003fde582efcce54da2cf0793c0e594686506e8897de47efa44113cf5723ae8c"
PORTRAIT_CHECKSUM = "8fe9582f197a30ad9ee4b3c7ee1bfff2a0af40ab6578d04482c391659ba22b72"

# Where the canal banks meet under the bridge, read off the photograph.
CANAL_BRIDGE = (0.50, 0.39)
PHOTOGRAPH_TOLERANCE = 0.03


def _detect(path: Path, checksum: str) -> PerspectiveResult:
    # `imread` applies EXIF orientation, which the tool requires of its caller.
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    assert isinstance(image, np.ndarray), f"could not decode {path}"
    return detect_perspective(image, source_checksum=checksum)


def test_canal_finds_the_convergence_on_the_bridge() -> None:
    result = _detect(CANAL, CANAL_CHECKSUM)

    nearest = min(
        result.vanishing_points,
        key=lambda vp: (vp.point.x - CANAL_BRIDGE[0]) ** 2 + (vp.point.y - CANAL_BRIDGE[1]) ** 2,
    )
    assert nearest.point.x == pytest.approx(CANAL_BRIDGE[0], abs=PHOTOGRAPH_TOLERANCE)
    assert nearest.point.y == pytest.approx(CANAL_BRIDGE[1], abs=PHOTOGRAPH_TOLERANCE)


def test_canal_horizon_sits_at_the_bridge() -> None:
    horizon = _detect(CANAL, CANAL_CHECKSUM).horizon

    assert horizon is not None
    assert horizon.left.y == pytest.approx(CANAL_BRIDGE[1], abs=PHOTOGRAPH_TOLERANCE)
    assert horizon.right.y == pytest.approx(CANAL_BRIDGE[1], abs=PHOTOGRAPH_TOLERANCE)


def test_a_portrait_is_less_confident_than_an_architectural_scene() -> None:
    """A sweater's stripes are line families too, and RANSAC finds them. They must not come
    out as confident as a canal — routing (PR 12) declines perspective on a portrait, but the
    confidence should not need that to be right."""
    # The artifact confidence is the canal's *weakest* reported point.
    canal_weakest = _detect(CANAL, CANAL_CHECKSUM).metadata.confidence
    portrait_points = _detect(PORTRAIT, PORTRAIT_CHECKSUM).vanishing_points
    assert all(vp.confidence.value < canal_weakest for vp in portrait_points)
