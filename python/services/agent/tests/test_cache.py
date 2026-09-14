"""The read-through node cache: a miss computes and stores, a hit computes nothing.

The face is the case that matters. A miss runs a detection, and a detection sends Google a usage
report (#43), so every assertion here that a hit ran nothing is an assertion that a reopen sent
nothing.
"""

import logging

import pytest
from agent_support import (
    CHECKSUM,
    PHOTOGRAPH,
    PROJECT_ID,
    Detector,
    FakeArtistApi,
    synthetic_face,
)

from artloupe.agent.cache import FACE, PERSPECTIVE, cached_face, cached_perspective
from artloupe.agent.resources import RunResources, decode_original, use_run_resources
from artloupe.image_tools import head_tool_version

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")


@pytest.fixture
def resources(api: FakeArtistApi) -> RunResources:
    return RunResources(api=api, image=decode_original(PHOTOGRAPH, checksum=CHECKSUM))  # type: ignore[arg-type]


async def test_a_miss_detects_once_and_stores_the_face(
    api: FakeArtistApi, detector: Detector, resources: RunResources
) -> None:
    detector.face = synthetic_face()

    with use_run_resources(resources):
        face = await cached_face(PROJECT_ID, CHECKSUM)

    assert face == synthetic_face()
    assert detector.calls == 1
    (key,) = api.stores
    assert (key.tool, key.tool_version, key.source_checksum) == (
        FACE,
        head_tool_version(),
        CHECKSUM,
    )


async def test_a_hit_reloads_the_face_exactly_and_detects_nothing(
    api: FakeArtistApi, detector: Detector, resources: RunResources
) -> None:
    """The stored JSON must come back as the same face, computed fields derived again."""
    detector.face = synthetic_face()
    with use_run_resources(resources):
        await cached_face(PROJECT_ID, CHECKSUM)
        reloaded = await cached_face(PROJECT_ID, CHECKSUM)

    assert reloaded == synthetic_face()
    assert detector.calls == 1


async def test_no_face_is_cached_too(
    api: FakeArtistApi, detector: Detector, resources: RunResources
) -> None:
    """A photograph with no face must not be re-detected on every reopen either."""
    with use_run_resources(resources):
        first = await cached_face(PROJECT_ID, CHECKSUM)
        second = await cached_face(PROJECT_ID, CHECKSUM)

    assert first is None
    assert second is None
    assert detector.calls == 1


async def test_perspective_round_trips_through_the_cache(
    api: FakeArtistApi, resources: RunResources
) -> None:
    with use_run_resources(resources):
        computed = await cached_perspective(PROJECT_ID, CHECKSUM)
        reloaded = await cached_perspective(PROJECT_ID, CHECKSUM)

    assert reloaded == computed
    assert [key.tool for key in api.stores] == [PERSPECTIVE]


async def test_a_failed_store_does_not_fail_the_run(
    api: FakeArtistApi,
    detector: Detector,
    resources: RunResources,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A lost cache row costs a recomputation later. Failing the artist's run now is worse."""
    api.fail_stores = True
    detector.face = synthetic_face()

    with use_run_resources(resources), caplog.at_level(logging.ERROR):
        face = await cached_face(PROJECT_ID, CHECKSUM)

    assert face == synthetic_face()
    assert "failed to cache a tool result" in caplog.text
