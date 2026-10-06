"""Authenticated deterministic search; no agent/model invocation is needed."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from artloupe.agent.inspiration_cache import cached_search
from artloupe.agent.inspiration_models import SearchRequest, SearchResponse
from artloupe.agent.inspiration_providers import ProviderUnavailable
from artloupe.agent.inspiration_rate_limit import limiter
from artloupe.auth.dependencies import HttpClient, require_role
from artloupe.auth.tokens import VerifiedToken

router = APIRouter()

Searcher = Annotated[VerifiedToken, Depends(require_role("artist", "superuser"))]


@router.post("/inspiration/search", response_model=SearchResponse)
async def search(request: SearchRequest, user: Searcher, client: HttpClient) -> SearchResponse:
    if retry_after := limiter.acquire(user.subject):
        raise HTTPException(
            http_status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many searches.",
            headers={"Retry-After": str(retry_after)},
        )
    try:
        return await cached_search(request, client)
    except ProviderUnavailable as exc:
        raise HTTPException(
            exc.status, "Image search is temporarily unavailable.", headers={"Retry-After": "60"}
        ) from exc
