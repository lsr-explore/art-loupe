"""FastAPI guards built on `verify_access_token`.

Any Art Loupe service that serves authenticated routes depends on these rather than
re-deriving token handling, so there is exactly one answer to "is this caller who they say
they are" across the Python side.

Usage::

    from artloupe.auth.dependencies import CurrentUser, require_role

    @app.get("/critiques")
    async def list_critiques(user: CurrentUser) -> list[Critique]:
        ...

    @app.get("/costs", dependencies=[Depends(require_role("operator", "superuser"))])
    async def costs() -> CostReport:
        ...
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import AuthSettings, get_settings
from .tokens import InvalidTokenError, KeyResolutionError, VerifiedToken, verify_access_token

NOT_AUTHENTICATED = "Not authenticated."
NOT_PERMITTED = "Not permitted."
VERIFICATION_UNAVAILABLE = "Authentication is temporarily unavailable."

_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    """One connection pool per process, for fetching signing keys.

    Created lazily so importing this module has no side effects. Services that manage
    their own lifespan should compose `auth_lifespan` instead of relying on the fallback.
    """
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=get_settings().artloupe_auth_timeout_seconds)
    return _client


async def close_http_client() -> None:
    """Close the shared client. Called by `auth_lifespan`; also useful in tests."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


@asynccontextmanager
async def auth_lifespan() -> AsyncIterator[None]:
    """Lifespan fragment a consuming service can compose into its own."""
    try:
        yield
    finally:
        await close_http_client()


HttpClient = Annotated[httpx.AsyncClient, Depends(get_http_client)]
Settings = Annotated[AuthSettings, Depends(get_settings)]

bearer_scheme = HTTPBearer(auto_error=False)
BearerCredentials = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]


def _unauthenticated() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=NOT_AUTHENTICATED,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def require_token(
    credentials: BearerCredentials,
    client: HttpClient,
    settings: Settings,
) -> VerifiedToken:
    """Resolve and verify the bearer token, or refuse the request.

    A failure to *reach* the signing keys is a 503, never a 401. "We cannot check right
    now" must not read to the caller as "you are not who you say you are" — that would
    log every user out during a transient Supabase blip.
    """
    if credentials is None:
        raise _unauthenticated()

    try:
        return await verify_access_token(credentials.credentials, client, settings)
    except InvalidTokenError as exc:
        raise _unauthenticated() from exc
    except KeyResolutionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=VERIFICATION_UNAVAILABLE,
        ) from exc


CurrentUser = Annotated[VerifiedToken, Depends(require_token)]


def require_role(*allowed: str):
    """Guard a route on the caller's Art Loupe role.

    The role is read from `app_metadata`, which is writable only with the service-role key,
    so a user cannot promote themselves. `user_metadata` is user-writable and is never
    consulted — see `tokens.verify_access_token`.

    Note this is authorization *in addition to* Postgres RLS, not instead of it. Both run:
    the guard gives a clean 403 at the edge, RLS makes a bug here non-fatal.
    """
    if not allowed:
        raise ValueError("require_role needs at least one role.")

    async def dependency(user: CurrentUser) -> VerifiedToken:
        if user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=NOT_PERMITTED)
        return user

    return dependency
