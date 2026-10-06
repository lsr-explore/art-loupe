"""Shared Supabase Postgres cache, separate from user/project data.

Use a dedicated login with membership ONLY in artloupe_inspiration_cache. Never use
Supabase's service-role key or the project's database owner connection here.
Cache failure costs a provider call, not a failed search. Expired rows are replaced,
old keys are pruned on writes, and stale data is served for at most seven days.
"""

import asyncio
import hashlib
import json
import logging
import os
import time

from psycopg import AsyncConnection
from psycopg.types.json import Jsonb

from artloupe.agent.inspiration_models import SearchResponse
from artloupe.agent.inspiration_providers import ProviderUnavailable, search_provider

logger = logging.getLogger(__name__)
_connections = asyncio.Semaphore(4)
_searches = asyncio.Semaphore(4)
FRESH_SECONDS = 86400
STALE_SECONDS = 604800


def cache_key(request):
    canonical = json.dumps(request.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(("inspiration-v1:" + canonical).encode()).hexdigest()


class SharedCache:
    async def read(self, key):
        return await self._operation(key)

    async def write(self, key, response):
        await self._operation(key, response)

    async def _operation(self, key, response=None):
        dsn = os.environ.get("ARTLOUPE_INSPIRATION_DATABASE_URL")
        if not dsn:
            return None
        try:
            async with (
                asyncio.timeout(3),
                _connections,
                await AsyncConnection.connect(
                    dsn, connect_timeout=2, options="-c statement_timeout=1500"
                ) as conn,
            ):
                await conn.execute("SET ROLE artloupe_inspiration_cache")
                if response is None:
                    cursor = await conn.execute(
                        "SELECT response, extract(epoch from fetched_at) "
                        "FROM inspiration.search_cache WHERE key = %s "
                        "AND fetched_at > now() - interval '7 days'",
                        (key,),
                    )
                    row = await cursor.fetchone()
                    return (SearchResponse.model_validate(row[0]), float(row[1])) if row else None
                await conn.execute(
                    "INSERT INTO inspiration.search_cache (key, response) VALUES (%s, %s) "
                    "ON CONFLICT (key) DO UPDATE SET response = excluded.response, "
                    "fetched_at = now()",
                    (key, Jsonb(response.model_dump(mode="json"))),
                )
                await conn.execute(
                    "DELETE FROM inspiration.search_cache "
                    "WHERE fetched_at < now() - interval '7 days'"
                )
        except Exception:
            # No DSN, token, search text or provider response is written to the log.
            logger.warning("Inspiration cache unavailable")
        return None


async def cached_search(request, client, cache=None):
    cache = cache or SharedCache()
    key = cache_key(request)
    cached = await cache.read(key)
    if cached and time.time() - cached[1] < FRESH_SECONDS:
        return cached[0]
    try:
        async with asyncio.timeout(22), _searches:
            response = await search_provider(request, client)
    except (ProviderUnavailable, TimeoutError) as exc:
        if cached and time.time() - cached[1] < STALE_SECONDS:
            return cached[0].model_copy(update={"stale": True})
        raise ProviderUnavailable(getattr(exc, "status", 503)) from exc
    if not response.partial:
        await cache.write(key, response)
    return response
