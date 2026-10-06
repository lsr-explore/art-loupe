"""Shared Supabase Postgres cache, separate from user/project data.

Use a dedicated login with membership ONLY in artloupe_inspiration_cache. Never use
Supabase's service-role key or the project's database owner connection here.
Cache failure costs a provider call, not a failed search. Expired rows are replaced,
old keys are pruned on writes, and stale data is served for at most seven days.

Connections come from one small pool per process, opened on first use. A search
reads and possibly writes, so a per-operation connect would pay two TLS handshakes
to Supabase on every cache miss. The pool sets the restricted role once, when it
opens each connection, and its size is what bounds database load per instance.
"""

import asyncio
import hashlib
import json
import logging
import os
import time

from psycopg import AsyncConnection
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from artloupe.agent.inspiration_models import SearchRequest, SearchResponse
from artloupe.agent.inspiration_providers import ProviderUnavailable, search_provider

logger = logging.getLogger(__name__)
_searches = asyncio.Semaphore(4)
FRESH_SECONDS = 86400
STALE_SECONDS = 604800
POOL_MAX_SIZE = 4
# How long a cache operation waits for a pooled connection before treating it as a miss.
POOL_WAIT_SECONDS = 2

_pool: AsyncConnectionPool | None = None
_pool_lock = asyncio.Lock()


def cache_key(request: SearchRequest) -> str:
    canonical = json.dumps(request.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(("inspiration-v1:" + canonical).encode()).hexdigest()


async def _restrict_role(conn: AsyncConnection) -> None:
    # Session-level, so it holds for every later use of this pooled connection.
    await conn.execute("SET ROLE artloupe_inspiration_cache")
    await conn.commit()


async def _get_pool() -> AsyncConnectionPool | None:
    """Open the pool on first use; no DSN means the cache is simply off."""
    global _pool
    dsn = os.environ.get("ARTLOUPE_INSPIRATION_DATABASE_URL")
    if not dsn:
        return None
    async with _pool_lock:
        if _pool is None:
            pool = AsyncConnectionPool(
                dsn,
                open=False,
                # Idle until the first search; an unreachable database must not block startup.
                min_size=0,
                max_size=POOL_MAX_SIZE,
                timeout=POOL_WAIT_SECONDS,
                max_idle=300,
                kwargs={"connect_timeout": 2, "options": "-c statement_timeout=1500"},
                configure=_restrict_role,
                check=AsyncConnectionPool.check_connection,
            )
            await pool.open(wait=False)
            _pool = pool
    return _pool


async def close_cache_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


class SharedCache:
    async def read(self, key: str) -> tuple[SearchResponse, float] | None:
        return await self._operation(key)

    async def write(self, key: str, response: SearchResponse) -> None:
        await self._operation(key, response)

    async def _operation(
        self, key: str, response: SearchResponse | None = None
    ) -> tuple[SearchResponse, float] | None:
        try:
            pool = await _get_pool()
            if pool is None:
                return None
            async with asyncio.timeout(3), pool.connection() as conn:
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
