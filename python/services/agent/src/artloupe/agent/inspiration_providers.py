"""Fixed provider URLs, bounded fan-out, and strict image eligibility."""

import asyncio
import os
from urllib.parse import urlparse

import httpx

from artloupe.agent.inspiration_models import InspirationImage, SearchRequest, SearchResponse

MET = "https://collectionapi.metmuseum.org/public/collection"
PAGE_SIZE = 24
# Identify the application: the Met rejects httpx's default User-Agent.
MET_HEADERS = {
    "User-Agent": "ArtLoupe/1.0 (art inspiration; https://github.com/lsr-explore/art-loupe)"
}


class ProviderUnavailable(RuntimeError):
    def __init__(self, status=503):
        self.status = status
        super().__init__("Image search is temporarily unavailable.")


def safe_url(value, hosts):
    if not isinstance(value, str):
        return None
    parsed = urlparse(value)
    return (
        value
        if parsed.scheme == "https"
        and parsed.hostname in hosts
        and not parsed.username
        and not parsed.password
        and parsed.port in (None, 443)
        else None
    )


async def get_json(client, url, **kwargs):
    response = await client.get(url, timeout=5, **kwargs)
    if response.status_code == 429:
        raise ProviderUnavailable(429)
    response.raise_for_status()
    return response.json()


def painting(obj, artist=""):
    image = safe_url(
        obj.get("primaryImageSmall") or obj.get("primaryImage"), {"images.metmuseum.org"}
    )
    source = safe_url(obj.get("objectURL"), {"www.metmuseum.org", "metmuseum.org"})
    # hasImages includes records whose image cannot be reproduced. Verify the object itself.
    if (
        obj.get("classification") != "Paintings"
        or not obj.get("isPublicDomain")
        or not image
        or not source
    ):
        return None
    creator = obj.get("artistDisplayName") or ""
    if artist and artist.casefold() not in creator.casefold():
        return None
    title = obj.get("title") or "Untitled"
    return InspirationImage(
        id=f"met:{obj['objectID']}",
        source="met",
        image_url=image,
        source_url=source,
        title=title,
        creator=creator or None,
        medium=obj.get("medium") or None,
        date=obj.get("objectDate") or None,
        year=obj.get("objectBeginDate"),
        alt=title + (f" by {creator}" if creator else ""),
    )


async def search_pexels(request, client):
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        raise ProviderUnavailable()
    params = {"query": request.query, "page": request.page, "per_page": PAGE_SIZE}
    for name in ("orientation", "size", "color"):
        if value := getattr(request, name):
            params[name] = value
    data = await get_json(
        client, "https://api.pexels.com/v1/search", params=params, headers={"Authorization": key}
    )
    items = []
    for photo in data["photos"]:
        image = safe_url(photo.get("src", {}).get("medium"), {"images.pexels.com"})
        source = safe_url(photo.get("url"), {"www.pexels.com", "pexels.com"})
        if image and source:
            title = photo.get("alt") or "Untitled photograph"
            items.append(
                InspirationImage(
                    id=f"pexels:{photo['id']}",
                    source="pexels",
                    image_url=image,
                    source_url=source,
                    title=title,
                    alt=title,
                    creator=photo.get("photographer") or None,
                )
            )
    return SearchResponse(
        items=items, page=request.page, has_more=bool(data.get("next_page")) and request.page < 417
    )


async def search_met(request, client):
    offset = (request.page - 1) * PAGE_SIZE
    limit = min(PAGE_SIZE, 10000 - offset)
    params = {
        "q": request.query or request.artist,
        "medium": "Paintings",
        "hasImages": "true",
        "offset": offset,
        "limit": limit,
    }
    if request.artist and not request.query:
        params["artistOrCulture"] = "true"
    if request.highlights:
        params["isHighlight"] = "true"
    if request.date_begin is not None:
        params.update(dateBegin=request.date_begin, dateEnd=request.date_end)
    data = await get_json(client, f"{MET}/v1.1/search", params=params, headers=MET_HEADERS)
    ids = data.get("objectIDs") or []
    semaphore = asyncio.Semaphore(4)

    async def detail(object_id):
        async with semaphore:
            try:
                obj = await get_json(
                    client, f"{MET}/v1/objects/{int(object_id)}", headers=MET_HEADERS
                )
                return painting(obj, request.artist), False
            except (httpx.HTTPError, ValueError, KeyError, TypeError, ProviderUnavailable):
                return None, True

    details = await asyncio.gather(*(detail(i) for i in ids[:limit]))
    failed = any(failure for _, failure in details)
    if details and all(failure for _, failure in details):
        raise ProviderUnavailable()
    return SearchResponse(
        items=[item for item, _ in details if item is not None],
        page=request.page,
        has_more=offset + limit < min(data["total"], 10000),
        partial=failed,
    )


async def search_provider(request: SearchRequest, client: httpx.AsyncClient) -> SearchResponse:
    try:
        async with asyncio.timeout(18):
            return await (
                search_pexels(request, client)
                if request.source == "pexels"
                else search_met(request, client)
            )
    except (httpx.HTTPError, ValueError, KeyError, TypeError, TimeoutError) as exc:
        raise ProviderUnavailable() from exc
