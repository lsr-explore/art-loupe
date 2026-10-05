"""Authenticated deterministic search; no agent/model invocation is needed."""

from fastapi import APIRouter, HTTPException

from artloupe.agent.inspiration_cache import cached_search
from artloupe.agent.inspiration_models import SearchRequest, SearchResponse
from artloupe.agent.inspiration_providers import ProviderUnavailable
from artloupe.auth.dependencies import CurrentUser, HttpClient

router = APIRouter()


@router.post("/inspiration/search", response_model=SearchResponse)
async def search(request: SearchRequest, user: CurrentUser, client: HttpClient):
    if user.role not in {"artist", "superuser"}:
        raise HTTPException(403, "Not permitted.")
    try:
        return await cached_search(request, client)
    except ProviderUnavailable as exc:
        raise HTTPException(
            exc.status, "Image search is temporarily unavailable.", headers={"Retry-After": "60"}
        ) from exc
