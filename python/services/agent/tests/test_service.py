"""The HTTP surface: what it exposes without a token, what it refuses, and how a run reports.

Exercised through ASGI in-process rather than against a running server — no port to bind and
no lifespan race. Nothing here reaches Supabase: the anonymous cases run the real guard
against throwaway settings, and the authenticated cases substitute an already-verified token,
because verifying one is `libs/auth`'s job and is tested there. `execute_run` is replaced
wherever a test is about the endpoint rather than the graph; `test_graph.py` covers the graph.
"""

import time
from collections.abc import AsyncIterator, Iterator
from dataclasses import replace
from decimal import Decimal
from typing import Any

import httpx
import pytest

from artloupe.agent.nodes import ProjectNotReady
from artloupe.agent.resources import PhotographUnavailable
from artloupe.agent.routing import direct
from artloupe.agent.runtime import RunOutcome
from artloupe.agent.service import app
from artloupe.auth.config import get_settings
from artloupe.auth.dependencies import require_token
from artloupe.auth.tokens import VerifiedToken
from artloupe.metering import (
    BudgetExceeded,
    RecursionLimitExceeded,
    WallClockExceeded,
)
from artloupe.persistence import ArtistApi, ArtistApiError, CredentialRejected, ProjectNotFound
from artloupe.schemas import BudgetLedger

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")

PROJECT = "aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa"
BODY = {"project_id": PROJECT}

ARTIST = VerifiedToken(
    subject="4a1f0e2c-0000-4000-8000-000000000001",
    email="artist@example.test",
    role="artist",
    expires_at=4102444800,
    claims={},
    access_token="artist-access-token-for-tests",
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


class RecordedRun:
    """Replaces `execute_run`: records what the endpoint handed it, returns a finished run."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, _graph: object, initial: dict[str, Any], **kwargs: Any) -> RunOutcome:
        self.calls.append({"initial": initial, **kwargs})
        gate = {"face_found": False, "reason": "No face was found."}
        state = {
            **initial,
            "node_trail": ["load_project", "face_gate", "survey", "direct", "analyse"],
            "gate": gate,
            "manifest": direct({"gate": gate})["manifest"],
            "artifacts": [],
        }
        return RunOutcome(
            state=state, ledger=BudgetLedger(token_ceiling=1), metrics=[], cost_usd=Decimal(0)
        )


@pytest.fixture
def recorded(monkeypatch: pytest.MonkeyPatch) -> RecordedRun:
    stub = RecordedRun()
    monkeypatch.setattr("artloupe.agent.service.execute_run", stub)
    return stub


async def test_health_needs_no_token(client: httpx.AsyncClient) -> None:
    """A liveness probe has no token to present, and must not fail when auth is what broke."""
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "artloupe-agent", "version": "0.1.0"}


async def test_health_leaks_no_internal_detail(client: httpx.AsyncClient) -> None:
    """An unauthenticated endpoint should not be a reconnaissance surface."""
    body = await client.get("/health")
    assert set(body.json()) == {"status", "service", "version"}


@pytest.mark.trace(flow="platform.auth", category="security")
async def test_creating_a_run_without_a_token_is_refused(client: httpx.AsyncClient) -> None:
    response = await client.post("/runs", json=BODY)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


async def test_a_run_names_its_project(
    client: httpx.AsyncClient, authenticated: None, recorded: RecordedRun
) -> None:
    response = await client.post("/runs", json={})

    assert response.status_code == 422
    assert recorded.calls == []


async def test_creating_a_run_returns_the_routing_and_the_artifacts(
    client: httpx.AsyncClient, authenticated: None, recorded: RecordedRun
) -> None:
    response = await client.post("/runs", json=BODY)
    assert response.status_code == 200

    body = response.json()
    assert body["owner"] == ARTIST.subject
    assert body["project_id"] == PROJECT
    assert body["manifest"]["declined"] == [
        {"tool": "head_construction", "reason": "No face was found."}
    ]
    assert body["artifacts"] == []


@pytest.mark.trace(flow="platform.auth", category="security")
async def test_owner_comes_from_the_token(
    client: httpx.AsyncClient, authenticated: None, recorded: RecordedRun
) -> None:
    """`owner` is what Postgres RLS reads as `auth.uid()`; only the verified token may set it."""
    await client.post("/runs", json=BODY)

    (call,) = recorded.calls
    assert call["initial"]["owner"] == ARTIST.subject
    assert call["owner"] == ARTIST.subject


@pytest.mark.trace(flow="platform.auth", category="security")
async def test_a_body_that_names_an_owner_is_refused(
    client: httpx.AsyncClient, authenticated: None, recorded: RecordedRun
) -> None:
    """Refused outright, not ignored. Ignoring it is safe only until a field of that name exists."""
    response = await client.post(
        "/runs", json={**BODY, "owner": "someone-else", "run_id": "attacker"}
    )

    assert response.status_code == 422
    assert recorded.calls == []


@pytest.mark.trace(flow="platform.auth", category="security")
async def test_the_run_reads_the_project_as_the_artist(
    client: httpx.AsyncClient, authenticated: None, recorded: RecordedRun
) -> None:
    """The run's only credential is the artist's own token, so RLS decides what it can reach."""
    await client.post("/runs", json=BODY)

    (call,) = recorded.calls
    api = call["resources"].api
    assert isinstance(api, ArtistApi)
    assert api._token == ARTIST.access_token  # noqa: SLF001 — the credential is the assertion


@pytest.mark.trace(flow="platform.auth", category="security")
async def test_a_token_expiring_before_the_deadline_is_refused_before_any_work(
    client: httpx.AsyncClient, recorded: RecordedRun
) -> None:
    app.dependency_overrides[require_token] = lambda: replace(
        ARTIST, expires_at=int(time.time()) + 5
    )
    try:
        response = await client.post("/runs", json=BODY)
    finally:
        app.dependency_overrides.pop(require_token, None)

    assert response.status_code == 401
    assert recorded.calls == []


@pytest.mark.trace(flow="platform.auth", category="security")
async def test_a_token_supabase_rejects_mid_run_asks_for_a_refresh(
    client: httpx.AsyncClient, authenticated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The same remedy as a token about to expire: 401 with the refresh signal, never a 502."""

    async def rejected(*_args: object, **_kwargs: object) -> None:
        raise CredentialRejected("Supabase rejected the artist's token while trying to read")

    monkeypatch.setattr("artloupe.agent.service.execute_run", rejected)

    response = await client.post("/runs", json=BODY)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    ("failure", "status", "detail"),
    [
        (BudgetExceeded("plan budget exhausted"), 429, "plan budget exhausted"),
        (WallClockExceeded("run exceeded its deadline"), 504, "run exceeded its deadline"),
        (RecursionLimitExceeded("run exceeded its supersteps"), 500, "run exceeded its supersteps"),
        (ProjectNotFound("no project visible"), 404, "Project not found."),
        (ProjectNotReady("the project has no reference photograph yet"), 409, None),
        (PhotographUnavailable("the original could not be decoded as an image"), 422, None),
        (ArtistApiError("refused: HTTP 500"), 502, "The data service refused a call."),
    ],
)
async def test_a_stopped_run_is_reported_as_what_stopped_it(
    client: httpx.AsyncClient,
    authenticated: None,
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    status: int,
    detail: str | None,
) -> None:
    """A ceiling being reached is not an internal error, and a missing project is not either.

    Collapsing these onto a 500 would make a budget working exactly as designed, or a project
    the artist cannot see, indistinguishable from a fault.
    """

    async def stopped(*_args: object, **_kwargs: object) -> None:
        raise failure

    monkeypatch.setattr("artloupe.agent.service.execute_run", stopped)

    response = await client.post("/runs", json=BODY)
    assert response.status_code == status
    assert response.json() == {"detail": detail if detail is not None else str(failure)}
