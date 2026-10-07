"""Read the cost ledger for the operations dashboard, as `artloupe_ops_reader` and nothing else.

The connection comes from ARTLOUPE_OPS_DATABASE_URL, a login whose only useful membership is
`artloupe_ops_reader`. Every pooled connection sets that role before it is handed out, so
even a DSN with more reach reads only what the role can. Never the project-owner DSN, a
user token, or a Supabase service-role key.

The grouping happens here in SQL. `sum()` skips nulls, so `priced_cost_usd` is the sum of the
priced rows only, and `unpriced_rows` counts the rows a sum would otherwise hide.
"""

import asyncio
import os
from datetime import UTC, datetime, timedelta

import psycopg
from psycopg import AsyncConnection, IsolationLevel
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from artloupe.agent.ops_cost_models import (
    RECENT_RUNS_LIMIT,
    CostReport,
    CostTotals,
    CostWindow,
    ModelCost,
    NodeCost,
    RunCost,
)

OPS_ROLE = "artloupe_ops_reader"
POOL_MAX_SIZE = 2
POOL_WAIT_SECONDS = 2
QUERY_TIMEOUT_SECONDS = 5

WINDOW_LENGTHS: dict[CostWindow, timedelta] = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}

_TOTALS = """
    count(*)::int                                          as node_executions,
    count(*) filter (where attempt > 1)::int               as reexecutions,
    coalesce(sum(cost_usd), 0)                             as priced_cost_usd,
    count(*) filter (where cost_usd is null)::int          as unpriced_rows,
    coalesce(sum(input_tokens), 0)::bigint                 as input_tokens,
    coalesce(sum(output_tokens), 0)::bigint                as output_tokens,
    coalesce(sum(cache_read_tokens), 0)::bigint            as cache_read_tokens,
    coalesce(sum(cache_write_tokens), 0)::bigint           as cache_write_tokens,
    coalesce(sum(duration_ms), 0)::bigint                  as duration_ms
"""

_IN_WINDOW = "from public.run_node_metrics where started_at >= %(since)s"


class OpsDatabaseUnavailable(Exception):
    """No DSN is configured, or the database did not answer in time."""


_pool: AsyncConnectionPool | None = None
_pool_lock = asyncio.Lock()


async def _restrict_role(conn: AsyncConnection) -> None:
    # Session-level, so it holds for every later use of this pooled connection.
    await conn.execute(f"SET ROLE {OPS_ROLE}")
    await conn.commit()
    # One snapshot per report. The totals and each breakdown are separate queries, and at the
    # default READ COMMITTED a run landing between them would make the figures disagree.
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
                configure=_restrict_role,
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


async def build_cost_report(
    conn: AsyncConnection, window: CostWindow, now: datetime | None = None
) -> CostReport:
    """Aggregate the window's ledger rows on an already-restricted connection."""
    now = now or datetime.now(UTC)
    since = now - WINDOW_LENGTHS[window]
    params = {"since": since, "limit": RECENT_RUNS_LIMIT}
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"select {_TOTALS}, count(distinct run_id)::int as run_count {_IN_WINDOW}", params
        )
        totals_row = await cur.fetchone()
        run_count = totals_row.pop("run_count")

        await cur.execute(
            f"select model, {_TOTALS} {_IN_WINDOW} group by model "
            "order by priced_cost_usd desc, model nulls last",
            params,
        )
        by_model = [ModelCost(**row) for row in await cur.fetchall()]

        await cur.execute(
            f"select node, {_TOTALS} {_IN_WINDOW} group by node "
            "order by priced_cost_usd desc, node",
            params,
        )
        by_node = [NodeCost(**row) for row in await cur.fetchall()]

        # Sums stay inside the window; the start time does not. A run that began before the
        # window, or resumed into it, still shows and sorts by when it actually started.
        await cur.execute(
            f"""
            with windowed as (
                select run_id, {_TOTALS} {_IN_WINDOW} group by run_id
            ), began as (
                select run_id, min(started_at) as started_at from public.run_node_metrics
                where run_id in (select run_id from windowed) group by run_id
            )
            select windowed.*, began.started_at from windowed join began using (run_id)
            order by began.started_at desc, run_id limit %(limit)s
            """,
            params,
        )
        recent_runs = [RunCost(**row) for row in await cur.fetchall()]

    return CostReport(
        window=window,
        since=since,
        generated_at=now,
        run_count=run_count,
        totals=CostTotals(**totals_row),
        by_model=by_model,
        by_node=by_node,
        recent_runs=recent_runs,
    )


async def read_cost_report(window: CostWindow) -> CostReport:
    """The route's entry point: a pooled, role-restricted, read-only report."""
    pool = await _get_pool()
    try:
        async with asyncio.timeout(QUERY_TIMEOUT_SECONDS), pool.connection() as conn:
            report = await build_cost_report(conn, window)
            await conn.rollback()
            return report
    except (TimeoutError, psycopg.Error) as exc:
        # The pool's own timeout is a psycopg.Error too.
        raise OpsDatabaseUnavailable from exc
