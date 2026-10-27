"""Private image serving and deterministic PNG output, without provider calls."""

import cv2
import numpy as np
import pytest
import test_service as service_tests
from agent_support import PHOTOGRAPH, PROJECT_ID, FakeArtistApi

from artloupe.agent.artifact_routes import draw_path
from artloupe.image_tools import NormalizedPoint
from artloupe.persistence import ProjectNotFound

configured = service_tests.configured
client = service_tests.client
authenticated = service_tests.authenticated

pytestmark = pytest.mark.trace(flow="intake.project-intent", category="functionality")


@pytest.fixture
def image_api(monkeypatch):
    api = FakeArtistApi()
    monkeypatch.setattr("artloupe.agent.artifact_routes.ArtistApi", lambda *a, **kw: api)
    return api


@pytest.mark.parametrize(
    "tool",
    ["grayscale", "value_map", "value_shapes", "outline", "perspective", "head_construction"],
)
async def test_real_png(client, authenticated, image_api, detector, tool):
    response = await client.get(f"/projects/{PROJECT_ID}/artifacts/{tool}")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.content.startswith(b"\x89PNG\r\n\x1a\n")
    decoded = cv2.imdecode(np.frombuffer(response.content, np.uint8), cv2.IMREAD_COLOR)
    original = cv2.imdecode(np.frombuffer(PHOTOGRAPH, np.uint8), cv2.IMREAD_COLOR)
    if tool in {"perspective", "head_construction"}:
        assert decoded.shape == original.shape
    else:
        assert decoded.shape == (683, 1024, 3)
    if tool in {"value_shapes", "outline"}:
        assert decoded.min() < 100
        assert decoded.max() == 255


async def test_anonymous_cannot_request_images(client, image_api):
    response = await client.get(f"/projects/{PROJECT_ID}/artifacts/grayscale")
    assert response.status_code == 401


async def test_foreign_project_is_not_found(client, authenticated, image_api, monkeypatch):
    async def absent(*args):
        raise ProjectNotFound("absent")

    monkeypatch.setattr(image_api, "load_project", absent)
    response = await client.get(f"/projects/{PROJECT_ID}/artifacts/grayscale")
    assert response.status_code == 404
    assert response.headers.get("content-type") != "image/png"


async def test_unknown_tool_is_refused(client, authenticated, image_api):
    response = await client.get(f"/projects/{PROJECT_ID}/artifacts/invented")
    assert response.status_code == 422


def test_off_frame_line_is_clipped_without_clamping_endpoints():
    canvas = np.full((100, 100, 3), 255, np.uint8)
    draw_path(canvas, [NormalizedPoint(x=-2, y=-1), NormalizedPoint(x=2, y=1)])
    # Correct intersection is around y=50 on the right, not the bottom-right corner.
    assert canvas[49:52, 98].min() < 100
    assert np.all(canvas[98, 98] == 255)


async def test_recipe_mismatch_is_not_served(client, authenticated, image_api):
    response = await client.get(f"/projects/{PROJECT_ID}/artifacts/grayscale?checksum=wrong")
    assert response.status_code == 409


async def test_old_tool_version_is_not_served(client, authenticated, image_api):
    response = await client.get(f"/projects/{PROJECT_ID}/artifacts/grayscale?version=old")
    assert response.status_code == 409
