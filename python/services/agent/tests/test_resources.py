"""What a run holds outside its state: the photograph, proven to be the one its checksum names."""

import hashlib
import io

import pytest
from agent_support import CHECKSUM, PHOTOGRAPH, PROJECT_ID, FakeArtistApi, drawn_photograph

from artloupe.agent.resources import (
    PhotographUnavailable,
    RunResources,
    decode_original,
    photograph,
    run_resources,
    use_run_resources,
)

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")


@pytest.mark.trace(flow="platform.agent-runtime", category="data")
def test_bytes_that_do_not_match_the_checksum_are_refused() -> None:
    """FR-105: the checksum is the photograph's identity, whatever the storage key says."""
    with pytest.raises(PhotographUnavailable, match="checksum"):
        decode_original(PHOTOGRAPH, checksum="0" * 64)


def test_bytes_that_are_not_an_image_are_refused() -> None:
    garbage = b"not an image at all"

    with pytest.raises(PhotographUnavailable, match="decoded"):
        decode_original(garbage, checksum=hashlib.sha256(garbage).hexdigest())


def test_decoding_applies_exif_orientation() -> None:
    """Every tool requires an EXIF-oriented input. `imdecode` must apply it as `imread` does."""
    image_module = pytest.importorskip("PIL.Image")
    stored = image_module.new("RGB", (40, 20), color=(200, 200, 200))
    exif = image_module.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90° clockwise to display.
    buffer = io.BytesIO()
    stored.save(buffer, format="JPEG", exif=exif.tobytes())
    data = buffer.getvalue()

    decoded = decode_original(data, checksum=hashlib.sha256(data).hexdigest())

    assert decoded.shape[:2] == (40, 20)


def test_a_node_outside_a_run_cannot_reach_artist_data() -> None:
    with pytest.raises(RuntimeError, match="execute_run"):
        run_resources()


async def test_a_resumed_run_fetches_the_photograph_again_once() -> None:
    """After a resume in another process the image is absent; it is fetched, then reused."""
    api = FakeArtistApi()
    with use_run_resources(RunResources(api=api)):  # type: ignore[arg-type]
        first = await photograph(PROJECT_ID, CHECKSUM)
        second = await photograph(PROJECT_ID, CHECKSUM)

    assert first is second
    assert api.downloads == 1


async def test_a_resumed_run_refuses_a_changed_original() -> None:
    """A run began on specific bytes. Resuming it on any others would mix two photographs."""
    api = FakeArtistApi(photograph=drawn_photograph() + b"\x00")
    with (
        use_run_resources(RunResources(api=api)),  # type: ignore[arg-type]
        pytest.raises(PhotographUnavailable, match="not the one this run began on"),
    ):
        await photograph(PROJECT_ID, CHECKSUM)
