"""Read the cost ledger for the operations dashboard, as `artloupe_ops_reader` and nothing else.

The connection and its role restriction live in `ops_db`. The grouping happens here in SQL.
`sum()` skips nulls, so `priced_cost_usd` is the sum of the priced rows only, and
`unpriced_rows` counts the rows a sum would otherwise hide.
"""

from datetime import UTC, datetime

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from artloupe.agent.ops_cost_models import (
    RECENT_RUNS_LIMIT,
    CostReport,
    CostTotals,
    CostWindow,
    ModelCost,
    NodeCost,
    RunCost,
)
from artloupe.agent.ops_db import WINDOW_LENGTHS, read_as_ops

LEDGER_TOTALS = """
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


async def build_cost_report(
    conn: AsyncConnection, window: CostWindow, now: datetime | None = None
) -> CostReport:
    """Aggregate the window's ledger rows on an already-restricted connection."""
    now = now or datetime.now(UTC)
    since = now - WINDOW_LENGTHS[window]
    params = {"since": since, "limit": RECENT_RUNS_LIMIT}
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"select {LEDGER_TOTALS}, count(distinct run_id)::int as run_count {_IN_WINDOW}", params
        )
        totals_row = await cur.fetchone()
        run_count = totals_row.pop("run_count")

        await cur.execute(
            f"select model, {LEDGER_TOTALS} {_IN_WINDOW} group by model "
            "order by priced_cost_usd desc, model nulls last",
            params,
        )
        by_model = [ModelCost(**row) for row in await cur.fetchall()]

        await cur.execute(
            f"select node, {LEDGER_TOTALS} {_IN_WINDOW} group by node "
            "order by priced_cost_usd desc, node",
            params,
        )
        by_node = [NodeCost(**row) for row in await cur.fetchall()]

        # Sums stay inside the window; the start time does not. A run that began before the
        # window, or resumed into it, still shows and sorts by when it actually started.
        await cur.execute(
            f"""
            with windowed as (
                select run_id, {LEDGER_TOTALS} {_IN_WINDOW} group by run_id
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
    return await read_as_ops(lambda conn: build_cost_report(conn, window))
