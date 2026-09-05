"""The HTTP surface.

Per ADR 0002 the browser never reaches this service: a Next.js route handler forwards the
artist's Supabase access token, and `artloupe-auth` verifies it here. Python never sees a
credential — only a token someone else obtained.

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

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from artloupe.agent.graph import build_graph
from artloupe.agent.runtime import execute_run
from artloupe.agent.state import RunState
from artloupe.auth.dependencies import CurrentUser, auth_lifespan
from artloupe.metering import (
    BudgetExceeded,
    GuardTripped,
    WallClockExceeded,
)

SERVICE_NAME = "artloupe-agent"
SERVICE_VERSION = "0.1.0"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Compose the auth library's lifespan so its HTTP client is closed on shutdown.

    `artloupe-auth` keeps one connection pool per process for fetching signing keys. Without
    this the pool leaks on reload, which in local development looks like a slow socket leak
    rather than an error.
    """
    async with auth_lifespan():
        yield


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


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class RunResponse(BaseModel):
    run_id: str
    owner: str
    node_trail: list[str]


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness. Unauthenticated by design — see the module docstring."""
    return HealthResponse(status="ok", service=SERVICE_NAME, version=SERVICE_VERSION)


@app.post("/runs", response_model=RunResponse)
async def create_run(user: CurrentUser) -> RunResponse:
    """Start a run.

    A skeleton: the graph has one node and the response is the proof that an authenticated
    request reached a compiled LangGraph and came back. The Studio Director's routing takes
    this over in PR 12.

    `owner` comes from `user.subject` — the verified token's Supabase user id, which is what
    Postgres RLS reads as `auth.uid()`. Taking it from anywhere else would let a caller
    create runs against another artist's identity.
    """
    run_id = str(uuid4())
    initial: RunState = {"run_id": run_id, "owner": user.subject, "node_trail": []}
    outcome = await execute_run(_graph, initial, run_id=run_id, owner=user.subject)
    result: dict[str, Any] = outcome.state
    return RunResponse(
        run_id=result["run_id"],
        owner=result["owner"],
        node_trail=result["node_trail"],
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
