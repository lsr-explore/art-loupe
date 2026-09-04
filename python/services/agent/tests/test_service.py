"""The HTTP surface: what it exposes without a token, and what it refuses.

Exercised through ASGI in-process rather than against a running server — no port to bind and
no lifespan race. Nothing here reaches Supabase: the anonymous cases run the real guard
against throwaway settings, and the authenticated cases substitute an already-verified token,
because verifying one is `libs/auth`'s job and is tested there.
"""

from collections.abc import AsyncIterator, Iterator

import httpx
import pytest

from artloupe.agent.service import app
from artloupe.auth.config import get_settings
from artloupe.auth.dependencies import require_token
from artloupe.auth.tokens import VerifiedToken

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")

ARTIST = VerifiedToken(
    subject="4a1f0e2c-0000-4000-8000-000000000001",
    email="artist@example.test",
    role="artist",
    expires_at=4102444800,
    claims={},
)


@pytest.fixture(autouse=True)
def configured(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Configure the auth library for every request, including anonymous ones.

    FastAPI resolves the whole dependency tree before the endpoint runs, so
    `require_token`'s settings and HTTP client are constructed even when there is no
    credential to check. Without configuration the 401 path is unreachable in a test
    process — settings construction fails first and the request 500s.

    Done through the environment rather than `dependency_overrides` because
    `get_http_client()` calls `get_settings()` *directly* rather than through `Depends`, so
    an override reaches only half the tree. Configuring the environment exercises the real
    resolution path, which is also the one production uses.

    `cache_clear()` on both sides of the test because `get_settings` is `lru_cache`d, and a
    value cached here would otherwise leak into unrelated suites in the same process.
    """
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key-for-tests")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://agent.test") as session:
        yield session


@pytest.fixture
def authenticated() -> Iterator[None]:
    """Stand in for a verified Supabase token.

    Overriding the dependency rather than minting a JWT keeps this suite about the service.
    Token verification itself is covered by `libs/auth`, and duplicating it here would mean
    two places to update when the signing path changes.
    """
    app.dependency_overrides[require_token] = lambda: ARTIST
    yield
    # Pop only this key. `clear()` would also drop the autouse `configured` override, which
    # every test needs — including the ones that never ask for this fixture.
    app.dependency_overrides.pop(require_token, None)


async def test_health_needs_no_token(client: httpx.AsyncClient) -> None:
    """A liveness probe has no token to present, and must not fail when auth is what broke."""
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "artloupe-agent", "version": "0.1.0"}


@pytest.mark.trace(flow="platform.auth", category="security")
async def test_creating_a_run_without_a_token_is_refused(client: httpx.AsyncClient) -> None:
    response = await client.post("/runs")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


async def test_creating_a_run_returns_the_graph_result(
    client: httpx.AsyncClient, authenticated: None
) -> None:
    response = await client.post("/runs")
    assert response.status_code == 200

    body = response.json()
    assert body["owner"] == ARTIST.subject
    assert body["node_trail"] == [f"seed:{body['run_id']}"]


@pytest.mark.trace(flow="platform.auth", category="security")
async def test_owner_comes_from_the_token_not_the_request_body(
    client: httpx.AsyncClient, authenticated: None
) -> None:
    """A caller must not be able to create a run against someone else's identity.

    `owner` is what Postgres RLS will read as `auth.uid()`, so a body-supplied value that
    won the race here would be an authorization bypass rather than a cosmetic bug.
    """
    response = await client.post("/runs", json={"owner": "someone-else", "run_id": "attacker"})
    assert response.status_code == 200

    body = response.json()
    assert body["owner"] == ARTIST.subject
    assert body["run_id"] != "attacker"


async def test_health_leaks_no_internal_detail(client: httpx.AsyncClient) -> None:
    """An unauthenticated endpoint should not be a reconnaissance surface."""
    body = await client.get("/health")
    assert set(body.json()) == {"status", "service", "version"}
