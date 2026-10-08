"""The operations dashboard's one database path: a pool that reads as `artloupe_ops_reader`.

The connection comes from ARTLOUPE_OPS_DATABASE_URL, a login whose only useful membership is
`artloupe_ops_reader`. Every pooled connection sets that role before it is handed out, so
even a DSN with more reach reads only what the role can. Never the project-owner DSN, a
user token, or a Supabase service-role key.

Each report reads one snapshot. Its figures come from several queries, and at the default
READ COMMITTED a run landing between them would make them disagree.
"""

import asyncio
import os
from collections.abc import Awaitable, Callable
from datetime import timedelta

import psycopg
from psycopg import AsyncConnection, IsolationLevel
from psycopg_pool import AsyncConnectionPool

from artloupe.agent.ops_cost_models import CostWindow

OPS_ROLE = "artloupe_ops_reader"
POOL_MAX_SIZE = 2
POOL_WAIT_SECONDS = 2
QUERY_TIMEOUT_SECONDS = 5

WINDOW_LENGTHS: dict[CostWindow, timedelta] = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


class OpsDatabaseUnavailable(Exception):
    """No DSN is configured, or the database did not answer in time."""


_pool: AsyncConnectionPool | None = None
_pool_lock = asyncio.Lock()


async def restrict_role(conn: AsyncConnection) -> None:
    # Session-level, so it holds for every later use of this pooled connection.
    await conn.execute(f"SET ROLE {OPS_ROLE}")
    await conn.commit()
    await conn.set_isolation_level(IsolationLevel.REPEATABLE_READ)
    await conn.set_read_only(True)


async def _get_pool() -> AsyncConnectionPool:
    global _pool
    dsn = os.environ.get("ARTLOUPE_OPS_DATABASE_URL")
    if not dsn:
        raise OpsDatabaseUnavailable
    async with _pool_lock:
        if _pool is None:
            pool = AsyncConnectionPool(
                dsn,
                open=False,
                # Idle until the first report; an unreachable database must not block startup.
                min_size=0,
                max_size=POOL_MAX_SIZE,
                timeout=POOL_WAIT_SECONDS,
                max_idle=300,
                kwargs={"connect_timeout": 2, "options": "-c statement_timeout=4000"},
                configure=restrict_role,
                check=AsyncConnectionPool.check_connection,
            )
            await pool.open(wait=False)
            _pool = pool
    return _pool


async def close_ops_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def read_as_ops[T](build: Callable[[AsyncConnection], Awaitable[T]]) -> T:
    """Run one report builder on a pooled, role-restricted, read-only snapshot."""
    pool = await _get_pool()
    try:
        async with asyncio.timeout(QUERY_TIMEOUT_SECONDS), pool.connection() as conn:
            report = await build(conn)
            await conn.rollback()
            return report
    except (TimeoutError, psycopg.Error) as exc:
        # The pool's own timeout is a psycopg.Error too.
        raise OpsDatabaseUnavailable from exc
