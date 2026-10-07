"""The HTTP surface.

Per ADR 0002 the browser never reaches this service: a Next.js route handler forwards the
artist's Supabase access token, and `artloupe-auth` verifies it here. Python never mints a
credential — it only presents the one it was handed, back to Supabase, as the same artist.

- `GET /health` is **unauthenticated**, because a liveness probe has no token to present and
  a health check that can fail on auth reports the wrong thing when auth is what broke.
  It returns no state, no counts, and no build detail — an unauthenticated endpoint on a
  public deployment should not be a reconnaissance surface.
- `POST /runs` is **authenticated**, and takes its owner from the *verified token*, never
  from the request body. A caller cannot assert whose run this is. It records the run and
  returns 202 at once; the run continues as a background job (`artloupe.agent.jobs`).
- `GET /runs/{id}/events` streams that run's log over SSE (`artloupe.agent.stream`), read as
  the artist, so RLS decides whose runs a caller can follow.

Only what can fail *before* a run starts is an HTTP error here: a token about to expire, a
missing provider key, a project that is not the artist's. Everything after that is a `failed`
event in the run's log, because by then the response has already gone.

Every run goes through `artloupe.agent.runtime.execute_run`, never `graph.ainvoke` directly.
That is what keeps the loop guards and the budget ceiling from being optional: an endpoint
that invoked the graph itself would be unmetered and uncapped, and would look identical from
the outside to one that is not.
"""

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict

from artloupe.agent.director import close_director_client, director_client
from artloupe.agent.graph import build_graph
from artloupe.agent.inspiration_cache import close_cache_pool
from artloupe.agent.inspiration_routes import router as inspiration_router
from artloupe.agent.jobs import cancel_pending_runs, dispatch_run, run_job
from artloupe.agent.ops_db import close_ops_pool
from artloupe.agent.ops_routes import router as ops_router
from artloupe.agent.resources import RunResources
from artloupe.agent.state import RunState
from artloupe.agent.stream import closes_at, follow, fully_consumed, parse_cursor
from artloupe.auth.dependencies import CurrentUser, HttpClient, auth_lifespan
from artloupe.auth.tokens import VerifiedToken
from artloupe.config import SecretUnavailable
from artloupe.metering import RunGuards
from artloupe.persistence import (
    ArtistApi,
    ArtistApiError,
    CredentialRejected,
    InMemoryRunLog,
    ProjectNotFound,
    RunReader,
    get_run_log,
)

SERVICE_NAME = "artloupe-agent"
SERVICE_VERSION = "0.1.0"

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Compose the auth library's lifespan; close the Director's client and both pools on shutdown.

    `artloupe-auth` keeps one connection pool per process, and so does the Director's client. Runs
    reuse both, so each is closed once, here, rather than per request. Background runs are
    cancelled first, while the clients they hold are still open, so each can record itself as
    interrupted.
    """
    async with auth_lifespan():
        try:
            yield
        finally:
            await cancel_pending_runs()
            await close_director_client()
            await close_cache_pool()
            await close_ops_pool()


app = FastAPI(title=SERVICE_NAME, version=SERVICE_VERSION, lifespan=lifespan)

app.include_router(inspiration_router)
app.include_router(ops_router)

# Compiled once at import rather than per request. The graph is stateless and immutable;
# rebuilding it per call would re-validate the topology on every request for no benefit.
_graph = build_graph()


@app.exception_handler(ProjectNotFound)
async def project_not_found(_request: Request, _error: ProjectNotFound) -> JSONResponse:
    """404 for a project that is absent and for one that is somebody else's — one answer.

    RLS makes the two indistinguishable on purpose. Telling them apart here would let a caller
    probe which project ids exist.
    """
    return JSONResponse(status_code=404, content={"detail": "Project not found."})


@app.exception_handler(ArtistApiError)
async def artist_api_error(_request: Request, _error: ArtistApiError) -> JSONResponse:
    """502: Supabase refused or failed a call this service made on the artist's behalf.

    The upstream detail is not forwarded. A PostgREST error can quote the policy that fired.
    """
    return JSONResponse(status_code=502, content={"detail": "The data service refused a call."})


@app.exception_handler(CredentialRejected)
async def credential_rejected(_request: Request, _error: CredentialRejected) -> JSONResponse:
    """401 with the refresh signal: Supabase rejected the artist's token.

    The same answer a token about to expire gets, so a caller has one remedy for both. A 502 here
    would invite a retry with the same unusable token.
    """
    return JSONResponse(
        status_code=401,
        content={"detail": "Supabase rejected the access token. Refresh it and retry."},
        headers={"WWW-Authenticate": "Bearer"},
    )


@app.exception_handler(SecretUnavailable)
async def secret_unavailable(_request: Request, error: SecretUnavailable) -> JSONResponse:
    """503: the service has no key for the Director's model, a fault of its own configuration.

    The detail is fixed. The seam's own message names the keychain service and account it tried,
    which belongs in this service's log and not in a response.
    """
    logger.error("the Director has no provider key: %s", error)
    return JSONResponse(status_code=503, content={"detail": "The routing model is not configured."})


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class RunRequest(BaseModel):
    """What a caller may say about a run: which project. Nothing else.

    `extra="forbid"` so that a body naming an owner or a run id is refused outright rather than
    silently ignored. Ignoring it would be safe today and would stop being safe the day someone
    added a field of the same name.
    """

    model_config = ConfigDict(extra="forbid")

    project_id: UUID


class RunAccepted(BaseModel):
    """A recorded run. Its progress and result arrive on `events`, not in this response."""

    run_id: str
    status: Literal["queued"]
    events: str


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness. Unauthenticated by design — see the module docstring."""
    return HealthResponse(status="ok", service=SERVICE_NAME, version=SERVICE_VERSION)


@app.post("/runs", response_model=RunAccepted, status_code=status.HTTP_202_ACCEPTED)
async def create_run(request: RunRequest, user: CurrentUser, client: HttpClient) -> RunAccepted:
    """Record a run of one project, as the artist who owns it, and start it in the background.

    `owner` comes from `user.subject` — the verified token's Supabase user id, which is what
    Postgres RLS reads as `auth.uid()`. The recorder refuses a project that is not that owner's,
    with the same 404 as one that does not exist, and the run then reads the project with the
    artist's own token, so RLS still decides what it can reach.

    Everything that can be checked before work starts is checked here, and answered as an HTTP
    error: a token that would expire before the run's deadline, and a missing provider key. Each
    would otherwise fail the run partway through, after work had been spent.
    """
    guards = RunGuards.from_settings()
    if user.expires_at - time.time() < guards.wall_clock_seconds:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="The access token expires before a run could finish. Refresh it and retry.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    director = director_client()

    run_id = str(uuid4())
    project_id = str(request.project_id)
    log = get_run_log()
    await log.create(run_id=run_id, project_id=project_id, owner=user.subject)

    initial: RunState = {
        "run_id": run_id,
        "owner": user.subject,
        "project_id": project_id,
        "node_trail": [],
    }
    dispatch_run(
        run_job(
            _graph,
            initial,
            log=log,
            guards=guards,
            resources=RunResources(
                api=ArtistApi(user.access_token, client=client), director=director
            ),
        )
    )
    return RunAccepted(run_id=run_id, status="queued", events=f"/runs/{run_id}/events")


def _reader_for(user: VerifiedToken, client: httpx.AsyncClient) -> RunReader:
    """What this artist can see of their runs: RLS through their token, or the in-memory log."""
    log = get_run_log()
    if isinstance(log, InMemoryRunLog):
        return log.reader_for(user.subject)
    return ArtistApi(user.access_token, client=client)


@app.get("/runs/{run_id}/events")
async def run_events(
    run_id: UUID,
    user: CurrentUser,
    client: HttpClient,
    last_event_id: Annotated[str | None, Header()] = None,
) -> Response:
    """Stream the run's log as Server-Sent Events, from after `Last-Event-ID`.

    Visibility is checked before the stream opens, so a run that is absent or somebody else's is
    a plain 404 rather than a stream that never says anything. A client that already holds the
    run's final event gets 204, which stops its `EventSource` from reconnecting.
    """
    reader = _reader_for(user, client)
    if not await reader.run_visible(str(run_id)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found.")

    after = parse_cursor(last_event_id)
    if await fully_consumed(reader, str(run_id), after):
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return StreamingResponse(
        follow(
            reader,
            str(run_id),
            after=after,
            until=closes_at(user.expires_at),
        ),
        media_type="text/event-stream",
        # `no-transform` and `X-Accel-Buffering` stop a proxy from buffering the stream into
        # one late response.
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


def main() -> None:
    """Development entrypoint: `uv run python -m artloupe.agent.service`.

    Binds loopback deliberately. Nothing about this service should be reachable off the
    machine during local development, and the deployed binding is a deployment decision that
    does not exist yet.
    """
    import os

    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("ARTLOUPE_AGENT_PORT", "8080")))


if __name__ == "__main__":
    main()
