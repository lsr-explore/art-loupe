"""The artist-scoped Supabase client: what it presents, and what it refuses to say.

Hermetic. Every request goes to an `httpx.MockTransport` that records it, so each test can
assert on the exact request the agent would send. Whether Supabase then *honours* those requests
is a question about the row policies, and `test_tool_results_rls.py` answers it against a real
database.
"""

from collections.abc import Callable

import httpx
import pytest

from artloupe.persistence import (
    ArtistApi,
    ArtistApiError,
    ArtistApiSettings,
    ProjectNotFound,
    SourceImage,
    ToolResultKey,
    parameters_digest,
)

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="security")

SETTINGS = ArtistApiSettings(supabase_url="http://supabase.test/", supabase_anon_key="anon-key")
TOKEN = "the-artists-own-token"
PROJECT = "aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa"
CHECKSUM = "a" * 64
ORIGINAL = SourceImage(
    checksum=CHECKSUM,
    storage_key=f"owner/{PROJECT}/{CHECKSUM}",
    mime_type="image/jpeg",
    width_px=1600,
    height_px=1200,
)
KEY = ToolResultKey(
    project_id=PROJECT,
    source_checksum=CHECKSUM,
    tool="face",
    tool_version="2+opencv-5.0.0.numpy-2.5.0.mediapipe-0.10.35",
    parameters_digest="d" * 64,
)

Handler = Callable[[httpx.Request], httpx.Response]


def _api(handler: Handler) -> tuple[ArtistApi, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(record))
    return ArtistApi(TOKEN, client=client, settings=SETTINGS), seen


def _project_with_original(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/rest/v1/projects":
        return httpx.Response(200, json=[{"id": PROJECT, "intent": {"medium": "oil"}}])
    if request.url.path == "/rest/v1/source_images":
        return httpx.Response(
            200,
            json=[
                {
                    "checksum": ORIGINAL.checksum,
                    "storage_key": ORIGINAL.storage_key,
                    "mime_type": ORIGINAL.mime_type,
                    "width_px": ORIGINAL.width_px,
                    "height_px": ORIGINAL.height_px,
                }
            ],
        )
    return httpx.Response(404)


async def test_every_rest_call_presents_the_anon_apikey_and_the_artists_bearer() -> None:
    """The artist's token is the credential; the anon key only satisfies the gateway."""
    api, seen = _api(_project_with_original)

    project = await api.load_project(PROJECT)

    assert project.source == ORIGINAL
    assert project.intent == {"medium": "oil"}
    assert [request.url.path for request in seen] == ["/rest/v1/projects", "/rest/v1/source_images"]
    for request in seen:
        assert request.headers["apikey"] == "anon-key"
        assert request.headers["authorization"] == f"Bearer {TOKEN}"


async def test_the_original_is_read_from_the_private_bucket_with_the_bearer_alone() -> None:
    api, seen = _api(lambda _request: httpx.Response(200, content=b"jpeg bytes"))

    assert await api.download_original(ORIGINAL) == b"jpeg bytes"
    (request,) = seen
    assert request.url.path == f"/storage/v1/object/reference-images/{ORIGINAL.storage_key}"
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    assert "apikey" not in request.headers


async def test_a_project_hidden_by_rls_reads_as_not_found() -> None:
    """RLS returns no rows for another artist's project; that must not read as a server error."""
    api, _seen = _api(lambda _request: httpx.Response(200, json=[]))

    with pytest.raises(ProjectNotFound):
        await api.load_project(PROJECT)


async def test_a_project_with_no_original_yet_has_no_source() -> None:
    def no_original(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/rest/v1/projects":
            return httpx.Response(200, json=[{"id": PROJECT, "intent": None}])
        return httpx.Response(200, json=[])

    api, _seen = _api(no_original)

    project = await api.load_project(PROJECT)
    assert project.source is None


async def test_a_refusal_reports_the_status_and_not_the_body() -> None:
    """A PostgREST error body can quote the policy that fired; the caller gets the status only."""
    api, _seen = _api(
        lambda _request: httpx.Response(401, json={"message": "policy tool_results_select_own"})
    )

    with pytest.raises(ArtistApiError) as raised:
        await api.find_tool_result(KEY)

    assert "401" in str(raised.value)
    assert "policy" not in str(raised.value)


async def test_a_cache_lookup_filters_on_the_whole_recipe() -> None:
    """A tool version carries `+` and `.`.

    Both must reach PostgREST intact, or every lookup misses.
    """
    api, seen = _api(lambda _request: httpx.Response(200, json=[{"result": {"face": None}}]))

    assert await api.find_tool_result(KEY) == {"face": None}

    (request,) = seen
    assert request.url.path == "/rest/v1/tool_results"
    assert dict(request.url.params) == {
        "project_id": f"eq.{KEY.project_id}",
        "source_checksum": f"eq.{KEY.source_checksum}",
        "tool": f"eq.{KEY.tool}",
        "tool_version": f"eq.{KEY.tool_version}",
        "parameters_digest": f"eq.{KEY.parameters_digest}",
        "select": "result",
    }


async def test_a_cache_miss_is_none() -> None:
    api, _seen = _api(lambda _request: httpx.Response(200, json=[]))

    assert await api.find_tool_result(KEY) is None


async def test_storing_a_result_keeps_the_row_already_there_for_the_recipe() -> None:
    """Two runs racing on one recipe must both succeed; the loser keeps the winner's row."""
    api, seen = _api(lambda _request: httpx.Response(201))

    await api.store_tool_result(KEY, {"face": None})

    (request,) = seen
    assert request.method == "POST"
    assert request.url.params["on_conflict"] == "project_id,tool,tool_version,parameters_digest"
    assert "resolution=ignore-duplicates" in request.headers["prefer"]
    assert request.headers["authorization"] == f"Bearer {TOKEN}"


def test_the_client_never_prints_the_token() -> None:
    api, _seen = _api(lambda _request: httpx.Response(200))

    assert TOKEN not in repr(api)


def test_the_settings_have_nowhere_to_put_a_service_role_key() -> None:
    """No app runtime holds `service_role`.

    A field that could hold one would eventually be filled.
    """
    assert not any("service" in name for name in ArtistApiSettings.model_fields)


def test_parameters_digest_is_canonical() -> None:
    """Key order is an accident of serialization; it must not change which row a lookup finds."""
    first = parameters_digest({"levels": 5, "working_long_edge_px": 1024})
    reordered = parameters_digest({"working_long_edge_px": 1024, "levels": 5})

    assert first == reordered
    assert first != parameters_digest({"levels": 3, "working_long_edge_px": 1024})
    assert len(first) == 64


def test_parameters_digest_refuses_nan() -> None:
    """JSON has no NaN; a digest of Python's spelling of it would reproduce nowhere else."""
    with pytest.raises(ValueError):
        parameters_digest({"threshold": float("nan")})
