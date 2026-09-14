"""The HTTP surface.

Per ADR 0002 the browser never reaches this service: a Next.js route handler forwards the
artist's Supabase access token, and `artloupe-auth` verifies it here. Python never mints a
credential — it only presents the one it was handed, back to Supabase, as the same artist.

Two endpoints, and the difference between them is the point of this module:

- `GET /health` is **unauthenticated**, because a liveness probe has no token to present and
  a health check that can fail on auth reports the wrong thing when auth is what broke.
  It returns no state, no counts, and no build detail — an unauthenticated endpoint on a
  public deployment should not be a reconnaissance surface.
- `POST /runs` is **authenticated**, and takes its owner from the *verified token*, never
  from the request body. A caller cannot assert whose run this is.

Every run goes through `artloupe.agent.runtime.execute_run`, never `graph.ainvoke` directly.
That is what keeps the loop guards and the budget ceiling from being optional: an endpoint
that invoked the graph itself would be unmetered and uncapped, and would look identical from
the outside to one that is not.
"""

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from artloupe.agent.director import RoutingFailed, close_director_client, director_client
from artloupe.agent.graph import build_graph
from artloupe.agent.nodes import ProjectNotReady
from artloupe.agent.resources import PhotographUnavailable, RunResources
from artloupe.agent.runtime import execute_run
from artloupe.agent.state import RunState
from artloupe.auth.dependencies import CurrentUser, HttpClient, auth_lifespan
from artloupe.config import SecretUnavailable
from artloupe.metering import (
    BudgetExceeded,
    GuardTripped,
    RunGuards,
    WallClockExceeded,
)
from artloupe.persistence import ArtistApi, ArtistApiError, CredentialRejected, ProjectNotFound
from artloupe.schemas import ArtifactMetadata, RoutingDecision

SERVICE_NAME = "artloupe-agent"
SERVICE_VERSION = "0.1.0"

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Compose the auth library's lifespan, and close the Director's client, on shutdown.

    `artloupe-auth` keeps one connection pool per process, and so does the Director's client. Runs
    reuse both, so each is closed once, here, rather than per request.
    """
    async with auth_lifespan():
        try:
            yield
        finally:
            await close_director_client()


app = FastAPI(title=SERVICE_NAME, version=SERVICE_VERSION, lifespan=lifespan)

# Compiled once at import rather than per request. The graph is stateless and immutable;
# rebuilding it per call would re-validate the topology on every request for no benefit.
_graph = build_graph()


# How a stopped run is reported. A ceiling being reached is not an internal error, and
# collapsing every ceiling onto a 500 would make a budget working as designed
# indistinguishable from a fault:
#
# - a plan budget exhausted is a quota, and 429 is what callers already retry-or-stop on;
# - a run that ran out of time is a 504, which is what it is from the caller's side;
# - a graph that looped is the unmapped default, 500, because a run that will not converge
#   is our bug rather than the caller's and no change to the request fixes it.
_GUARD_STATUS: dict[type[GuardTripped], int] = {
    BudgetExceeded: 429,
    WallClockExceeded: 504,
}


@app.exception_handler(GuardTripped)
async def guard_tripped(_request: Request, error: GuardTripped) -> JSONResponse:
    """Report a run stopped by one of its own ceilings, with the reason it was stopped."""
    return JSONResponse(
        status_code=_GUARD_STATUS.get(type(error), 500),
        content={"detail": error.reason},
    )


@app.exception_handler(ProjectNotFound)
async def project_not_found(_request: Request, _error: ProjectNotFound) -> JSONResponse:
    """404 for a project that is absent and for one that is somebody else's — one answer.

    RLS makes the two indistinguishable on purpose. Telling them apart here would let a caller
    probe which project ids exist.
    """
    return JSONResponse(status_code=404, content={"detail": "Project not found."})


@app.exception_handler(ProjectNotReady)
async def project_not_ready(_request: Request, error: ProjectNotReady) -> JSONResponse:
    """409: the project exists but has no photograph or no intake, so there is nothing to route."""
    return JSONResponse(status_code=409, content={"detail": str(error)})


@app.exception_handler(PhotographUnavailable)
async def photograph_unavailable(_request: Request, error: PhotographUnavailable) -> JSONResponse:
    """422: the original is there but cannot be analysed as the photograph it claims to be."""
    return JSONResponse(status_code=422, content={"detail": str(error)})


@app.exception_handler(ArtistApiError)
async def artist_api_error(_request: Request, _error: ArtistApiError) -> JSONResponse:
    """502: Supabase refused or failed a call this service made on the artist's behalf.

    The upstream detail is not forwarded. A PostgREST error can quote the policy that fired.
    """
    return JSONResponse(status_code=502, content={"detail": "The data service refused a call."})


@app.exception_handler(CredentialRejected)
async def credential_rejected(_request: Request, _error: CredentialRejected) -> JSONResponse:
    """401 with the refresh signal: Supabase rejected the artist's token partway through a run.

    The same answer a token expiring before the run gets, so a caller has one remedy for both. A
    502 here would invite a retry with the same unusable token.
    """
    return JSONResponse(
        status_code=401,
        content={
            "detail": "Supabase rejected the access token during the run. Refresh it and retry."
        },
        headers={"WWW-Authenticate": "Bearer"},
    )


@app.exception_handler(RoutingFailed)
async def routing_failed(_request: Request, error: RoutingFailed) -> JSONResponse:
    """502: the Director's model answered, but not with a decision the run can use.

    The run stops rather than routing on a guess. A refusal is reported the same way, with its
    category, because the remedy is the same: nothing in the request can change the outcome.
    """
    return JSONResponse(status_code=502, content={"detail": str(error)})


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


class RunResponse(BaseModel):
    run_id: str
    owner: str
    project_id: str
    node_trail: list[str]
    gate: dict[str, Any]
    routing: RoutingDecision
    artifacts: list[ArtifactMetadata]


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness. Unauthenticated by design — see the module docstring."""
    return HealthResponse(status="ok", service=SERVICE_NAME, version=SERVICE_VERSION)


@app.post("/runs", response_model=RunResponse)
async def create_run(request: RunRequest, user: CurrentUser, client: HttpClient) -> RunResponse:
    """Route and analyse one project, as the artist who owns it.

    `owner` comes from `user.subject` — the verified token's Supabase user id, which is what
    Postgres RLS reads as `auth.uid()`. The run reads the project with that same artist's token,
    so RLS, not this handler, decides whether the project is theirs.

    A token that would expire before the run's deadline is refused up front. A token that expired
    partway through would fail on some later Supabase call, after work had been spent. The
    Director's client is resolved up front for the same reason: a missing provider key is a 503
    before any work, rather than a failure at the fourth node.
    """
    guards = RunGuards.from_settings()
    if user.expires_at - time.time() < guards.wall_clock_seconds:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="The access token expires before a run could finish. Refresh it and retry.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    run_id = str(uuid4())
    initial: RunState = {
        "run_id": run_id,
        "owner": user.subject,
        "project_id": str(request.project_id),
        "node_trail": [],
    }
    outcome = await execute_run(
        _graph,
        initial,
        run_id=run_id,
        owner=user.subject,
        guards=guards,
        resources=RunResources(
            api=ArtistApi(user.access_token, client=client), director=director_client()
        ),
    )
    result: dict[str, Any] = outcome.state
    return RunResponse(
        run_id=result["run_id"],
        owner=result["owner"],
        project_id=result["project_id"],
        node_trail=result["node_trail"],
        gate=result["gate"],
        routing=RoutingDecision.model_validate(result["routing"]),
        artifacts=[ArtifactMetadata.model_validate(entry) for entry in result["artifacts"]],
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
