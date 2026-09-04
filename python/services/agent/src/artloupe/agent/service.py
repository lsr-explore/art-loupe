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
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

from fastapi import FastAPI
from pydantic import BaseModel

from artloupe.agent.graph import build_graph
from artloupe.agent.state import RunState
from artloupe.auth.dependencies import CurrentUser, auth_lifespan

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
    initial: RunState = {"run_id": str(uuid4()), "owner": user.subject, "node_trail": []}
    result: dict[str, Any] = await _graph.ainvoke(initial)
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
