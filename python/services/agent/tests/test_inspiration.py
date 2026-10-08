"""No provider calls: exercise wire requests through httpx.MockTransport."""

import asyncio
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from artloupe.agent import inspiration_providers
from artloupe.agent.inspiration_cache import (
    cache_key,
    cached_search,
    close_cache_pool,
)
from artloupe.agent.inspiration_models import SearchRequest, SearchResponse
from artloupe.agent.inspiration_providers import ProviderUnavailable, painting, search_provider
from artloupe.agent.inspiration_rate_limit import RateLimiter
from artloupe.agent.inspiration_routes import router
from artloupe.auth.dependencies import get_http_client, require_token

pytestmark = pytest.mark.trace(flow="inspiration.search", category="functionality")


def object_record(**overrides):
    return {
        "objectID": 1,
        "classification": "Paintings",
        "isPublicDomain": True,
        "primaryImageSmall": "https://images.metmuseum.org/painting.jpg",
        "objectURL": "https://www.metmuseum.org/art/collection/search/1",
        "title": "Sunflowers",
        "artistDisplayName": "Vincent van Gogh",
        "medium": "Oil on canvas",
        "objectDate": "1887",
        "objectBeginDate": 1887,
        **overrides,
    }


@pytest.mark.parametrize(
    "overrides",
    [
        {"classification": "Drawings"},
        {"isPublicDomain": False},
        {"primaryImageSmall": ""},
        {"primaryImageSmall": "https://evil.example/image"},
        {"primaryImageSmall": "http://images.metmuseum.org/a"},
    ],
)
def test_met_excludes_ineligible_images(overrides):
    assert painting(object_record(**overrides)) is None


def test_artist_is_checked_against_actual_artist_not_culture():
    assert painting(object_record(), "Gogh").creator == "Vincent van Gogh"
    assert painting(object_record(), "French") is None


@pytest.mark.parametrize(
    "search_input",
    [
        {"source": "pexels", "query": "trees", "artist": "Gogh"},
        {"source": "met", "query": "trees", "orientation": "portrait"},
        {"source": "met", "query": "trees", "date_begin": 1900},
        {"source": "met", "query": "trees", "date_begin": 1900, "date_end": 1800},
        {"source": "pexels", "query": " "},
        {"source": "met", "query": "trees", "page": 418},
    ],
)
def test_request_rejects_invalid_filters(search_input):
    with pytest.raises(ValidationError):
        SearchRequest(**search_input)


async def test_met_uses_paginated_endpoint_and_preserves_partial_success():
    calls = []

    def handle(request):
        calls.append(request)
        # Both search and object requests must identify our application.
        assert request.headers["User-Agent"].startswith("ArtLoupe/1.0")
        if request.url.path.endswith("search"):
            return httpx.Response(200, json={"total": 60, "objectIDs": [1, 2, 3]})
        if request.url.path.endswith("2"):
            return httpx.Response(503)
        return httpx.Response(
            200, json=object_record(objectID=int(request.url.path.split("/")[-1]))
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await search_provider(SearchRequest(source="met", artist="Gogh", page=2), client)
    assert calls[0].url.path.endswith("v1.1/search")
    assert dict(calls[0].url.params) == {
        "q": "Gogh",
        "medium": "Paintings",
        "hasImages": "true",
        "offset": "24",
        "limit": "24",
        "artistOrCulture": "true",
    }
    assert len(result.items) == 2 and result.partial and result.has_more


async def test_pexels_sends_only_supported_filters(monkeypatch):
    monkeypatch.setattr(inspiration_providers, "get_pexels_api_key", lambda: "test-key")

    def handle(request):
        assert request.headers["Authorization"] == "test-key"
        assert dict(request.url.params) == {
            "query": "trees",
            "page": "1",
            "per_page": "24",
            "orientation": "portrait",
            "color": "green",
        }
        return httpx.Response(
            200,
            json={
                "photos": [
                    {
                        "id": 2,
                        "src": {"medium": "https://images.pexels.com/a.jpg"},
                        "url": "https://www.pexels.com/photo/2",
                        "photographer": "Pat",
                        "alt": "Trees",
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await search_provider(
            SearchRequest(source="pexels", query="trees", orientation="portrait", color="green"),
            client,
        )
    assert (
        result.items[0].creator == "Pat"
        and result.items[0].medium is None
        and result.items[0].date is None
    )


async def test_provider_rate_limit_is_an_outage_not_an_empty_result(monkeypatch):
    monkeypatch.setattr(inspiration_providers, "get_pexels_api_key", lambda: "test-key")
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(429))
    ) as client:
        with pytest.raises(ProviderUnavailable) as error:
            await search_provider(SearchRequest(source="pexels", query="trees"), client)
    # The shared quota is spent for every artist, so this caller is not told to slow down.
    assert error.value.status == 503


async def test_met_detail_rate_limit_is_an_outage_not_a_partial_page():
    def handle(request):
        if request.url.path.endswith("search"):
            return httpx.Response(200, json={"total": 2, "objectIDs": [1, 2]})
        if request.url.path.endswith("2"):
            return httpx.Response(429)
        return httpx.Response(200, json=object_record())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(ProviderUnavailable):
            await search_provider(SearchRequest(source="met", query="sunflowers"), client)


async def test_met_detail_rate_limit_serves_stale_cache(monkeypatch):
    def handle(request):
        if request.url.path.endswith("search"):
            return httpx.Response(200, json={"total": 2, "objectIDs": [1, 2]})
        if request.url.path.endswith("2"):
            return httpx.Response(429)
        return httpx.Response(200, json=object_record())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await cached_search(
            SearchRequest(source="met", query="sunflowers"), client, MemoryCache(90000)
        )
    assert result.stale and not result.partial


async def test_met_detail_deadline_returns_the_details_that_arrived(monkeypatch):
    monkeypatch.setattr(inspiration_providers, "MET_DETAIL_BUDGET_SECONDS", 0.2)

    async def handle(request):
        if request.url.path.endswith("search"):
            return httpx.Response(200, json={"total": 2, "objectIDs": [1, 2]})
        if request.url.path.endswith("2"):
            await asyncio.sleep(5)
        return httpx.Response(
            200, json=object_record(objectID=int(request.url.path.split("/")[-1]))
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        started = time.monotonic()
        result = await search_provider(SearchRequest(source="met", query="sunflowers"), client)
    assert time.monotonic() - started < 2
    assert [item.id for item in result.items] == ["met:1"] and result.partial


class MemoryCache:
    def __init__(self, age=None):
        self.row = (
            None
            if age is None
            else (SearchResponse(items=[], page=1, has_more=False), time.time() - age)
        )
        self.writes = []

    async def read(self, key):
        return self.row

    async def write(self, key, response):
        self.writes.append(response)


async def test_fresh_cache_avoids_provider_calls():
    cache = MemoryCache(60)
    result = await cached_search(SearchRequest(source="pexels", query="trees"), None, cache)
    assert not result.stale and not cache.writes


async def test_stale_cache_survives_outage_but_not_beyond_seven_days(monkeypatch):
    monkeypatch.setattr(inspiration_providers, "get_pexels_api_key", lambda: None)
    request = SearchRequest(source="pexels", query="trees")
    result = await cached_search(request, None, MemoryCache(90000))
    assert result.stale
    with pytest.raises(ProviderUnavailable):
        await cached_search(request, None, MemoryCache(700000))


async def test_cache_write_failure_does_not_fail_provider_result(monkeypatch):
    monkeypatch.setenv("ARTLOUPE_INSPIRATION_DATABASE_URL", "not-a-dsn")
    monkeypatch.setattr("artloupe.agent.inspiration_cache.POOL_WAIT_SECONDS", 0.2)
    response = SearchResponse(items=[], page=1, has_more=False)

    async def provider(*_):
        return response

    monkeypatch.setattr("artloupe.agent.inspiration_cache.search_provider", provider)
    try:
        # The real SharedCache: its read is a miss and its failed write is swallowed.
        result = await cached_search(SearchRequest(source="met", query="trees"), None)
    finally:
        await close_cache_pool()
    assert result is response


async def test_success_is_cached_and_partial_success_is_not(monkeypatch):
    cache = MemoryCache()
    response = SearchResponse(items=[], page=1, has_more=False)

    async def provider(*_):
        return response

    monkeypatch.setattr("artloupe.agent.inspiration_cache.search_provider", provider)
    request = SearchRequest(source="met", query="trees")
    await cached_search(request, None, cache)
    assert cache.writes == [response]
    response.partial = True
    cache.writes.clear()
    await cached_search(request, None, cache)
    assert not cache.writes


def test_cache_key_normalizes_whitespace_and_separates_filters_and_sources():
    assert cache_key(SearchRequest(source="met", query=" trees ")) == cache_key(
        SearchRequest(source="met", query="trees")
    )
    assert cache_key(SearchRequest(source="met", query="trees")) != cache_key(
        SearchRequest(source="pexels", query="trees")
    )


async def test_http_route_requires_auth_and_rejects_operator():
    from artloupe.auth.config import AuthSettings, get_settings

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_settings] = lambda: AuthSettings(
        supabase_url="http://test", supabase_anon_key="test-anon"
    )
    app.dependency_overrides[get_http_client] = lambda: None
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (
            await client.post("/inspiration/search", json={"source": "met", "query": "trees"})
        ).status_code == 401
        app.dependency_overrides[require_token] = lambda: SimpleNamespace(
            role="operator", subject="operator-1"
        )
        assert (
            await client.post("/inspiration/search", json={"source": "met", "query": "trees"})
        ).status_code == 403


async def test_http_route_maps_outage(monkeypatch):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_token] = lambda: SimpleNamespace(
        role="artist", subject="artist-outage"
    )
    app.dependency_overrides[get_http_client] = lambda: None

    async def unavailable(*_):
        raise ProviderUnavailable()

    monkeypatch.setattr("artloupe.agent.inspiration_routes.cached_search", unavailable)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/inspiration/search", json={"source": "met", "query": "trees"}
        )
    assert response.status_code == 503 and response.headers["Retry-After"] == "60"


async def test_http_route_limits_each_artist_separately(monkeypatch):
    app = FastAPI()
    app.include_router(router)
    caller = {"subject": "artist-a"}
    app.dependency_overrides[require_token] = lambda: SimpleNamespace(
        role="artist", subject=caller["subject"]
    )
    app.dependency_overrides[get_http_client] = lambda: None
    monkeypatch.setattr(
        "artloupe.agent.inspiration_routes.limiter", RateLimiter(burst=1, refill_per_second=0.5)
    )

    async def found(*_):
        return SearchResponse(items=[], page=1, has_more=False)

    monkeypatch.setattr("artloupe.agent.inspiration_routes.cached_search", found)
    body = {"source": "met", "query": "trees"}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.post("/inspiration/search", json=body)).status_code == 200
        limited = await client.post("/inspiration/search", json=body)
        caller["subject"] = "artist-b"
        other = await client.post("/inspiration/search", json=body)
    assert limited.status_code == 429 and limited.headers["Retry-After"] == "2"
    assert other.status_code == 200


def test_rate_limiter_refills_and_reports_wait():
    now = [0.0]
    limiter = RateLimiter(burst=2, refill_per_second=0.5, clock=lambda: now[0])
    assert limiter.acquire("a") == 0 and limiter.acquire("a") == 0
    assert limiter.acquire("a") == 2
    now[0] = 2.0
    assert limiter.acquire("a") == 0


def test_rate_limiter_stays_bounded_by_evicting_the_least_recent():
    limiter = RateLimiter(burst=1, refill_per_second=0.001, clock=lambda: 0.0, max_tracked=2)
    assert limiter.acquire("a") == 0 and limiter.acquire("b") == 0
    assert limiter.acquire("a") > 0  # refused, but still the most recent
    assert limiter.acquire("c") == 0  # evicts "b", the least recent
    assert len(limiter._buckets) == 2
    assert limiter.acquire("a") > 0  # "a" kept its empty bucket
    assert limiter.acquire("b") == 0  # "b" was forgotten and starts with a full burst


def test_shared_typescript_python_request_fixture():
    import json
    from pathlib import Path

    fixture = json.loads(
        (
            Path(__file__).resolve().parents[4]
            / "packages/schemas/fixtures/inspiration-parity.json"
        ).read_text()
    )
    for value in fixture["accepts"]:
        SearchRequest.model_validate(value)
    for value in fixture["rejects"]:
        with pytest.raises(ValidationError):
            SearchRequest.model_validate(value)
