"""Construction of the LangGraph checkpoint saver.

One job, and it is the one that makes FR-402/403/404 possible: an artist corrects a
low-confidence guide and resumes, and the run picks up from where it paused — potentially
minutes later, and **in a different process** than the one that started it. That last clause
is why an in-memory saver is only ever correct in tests.

Three decisions worth not re-deriving later:

- **One pool per process, not per graph.** `AsyncPostgresSaver` takes a connection, and a
  graph that constructed its own would open a pool per call. The singleton is built behind a
  lock so concurrent first-requests cannot race two pools into existence.
- **Tables live in `langgraph`, never `public`.** `supabase/config.toml` exposes
  `["public", "graphql_public"]` through PostgREST, so an unprotected table in `public` is
  readable by anyone holding the anon key — a public value by design. The saver has **no
  schema parameter**, so isolation comes from `search_path` on the connection.
- **`autocommit=True` and `prepare_threshold=None` are required**, not stylistic.
  `.setup()` issues DDL that must not sit in an open transaction, and pgbouncer-style pooling
  chokes on prepared statements.
"""

import asyncio

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver

from artloupe.persistence.config import CHECKPOINT_SCHEMA, get_settings

_saver: BaseCheckpointSaver | None = None
_lock = asyncio.Lock()


def connection_kwargs() -> dict[str, object]:
    """psycopg connection settings the saver requires.

    `options=-csearch_path=...` is what puts the checkpoint tables in their own schema —
    `AsyncPostgresSaver` has no schema argument, so this is the only lever. `public` is kept
    on the path after it so the saver can still resolve built-in types and extensions.
    """
    return {
        "autocommit": True,
        "prepare_threshold": None,
        "options": f"-csearch_path={CHECKPOINT_SCHEMA},public",
    }


async def _create_schema(conninfo: str) -> None:
    """Ensure the checkpoint schema exists before the saver creates tables in it.

    Runs as its own short-lived connection rather than through the pool: the pool's
    `search_path` already points at a schema that may not exist yet, and a connection whose
    search_path names a missing schema is fine until something tries to *create* in it.
    """
    from psycopg import AsyncConnection

    async with await AsyncConnection.connect(conninfo, autocommit=True) as conn:
        await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{CHECKPOINT_SCHEMA}"')


async def _build_postgres_saver() -> BaseCheckpointSaver:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg_pool import AsyncConnectionPool

    settings = get_settings()
    await _create_schema(settings.database_url)

    pool = AsyncConnectionPool(
        conninfo=settings.database_url,
        max_size=settings.artloupe_checkpoint_pool_max,
        # `open=False` then an explicit `open()`: constructing an open pool inside a running
        # event loop emits a deprecation warning and hides connection errors until first use.
        open=False,
        kwargs=connection_kwargs(),
    )
    await pool.open()

    saver = AsyncPostgresSaver(pool)
    try:
        # Idempotent: creates the checkpoint tables if absent, migrates them if behind.
        await saver.setup()
    except Exception:
        # Close the pool rather than leaking it. A failed setup that leaves a pool open makes
        # the *next* failure look like connection exhaustion instead of the real cause.
        await pool.close()
        raise
    return saver


async def get_async_checkpointer() -> BaseCheckpointSaver:
    """The process-wide checkpointer.

    Returns an in-memory saver unless persistence is switched to `postgres`, so unit tests
    and CI stay hermetic without every caller branching on configuration.
    """
    settings = get_settings()
    if not settings.persistence_enabled:
        return InMemorySaver()

    global _saver
    if _saver is None:
        async with _lock:
            # Re-checked inside the lock: two coroutines can both pass the outer check before
            # either acquires it, and building two pools is exactly what the lock prevents.
            if _saver is None:
                _saver = await _build_postgres_saver()
    return _saver


async def reset_checkpointer() -> None:
    """Drop the cached saver, closing its pool. For tests and for a clean shutdown."""
    global _saver
    if _saver is not None:
        pool = getattr(_saver, "conn", None)
        if pool is not None and hasattr(pool, "close"):
            await pool.close()
        _saver = None
