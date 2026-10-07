"""Read run health (FR-901) for the operations dashboard, as `artloupe_ops_reader`.

Every query names its columns. The role's grant on `runs` is column-level and leaves out
`result` and `owner_id`, so `select *` would be refused rather than quietly over-reading.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from artloupe.agent.ops_cost import LEDGER_TOTALS
from artloupe.agent.ops_cost_models import CostWindow, NodeCost
from artloupe.agent.ops_db import WINDOW_LENGTHS, read_as_ops
from artloupe.agent.ops_runs_models import (
    RUN_LIST_LIMIT,
    DurationStats,
    FailureGroup,
    NodeStep,
    RunDetail,
    RunEvent,
    RunHealthReport,
    RunLedger,
    RunSummary,
    StatusCounts,
)
from artloupe.metering.config import get_settings

# A live run is cut off at its wall-clock deadline. Past that and a margin, a run still marked
# queued or running is not slow; nothing is moving it.
STALL_MARGIN_SECONDS = 60


class RunNotFound(Exception):
    pass


def stall_after_seconds() -> int:
    return int(get_settings().artloupe_run_wall_clock_seconds) + STALL_MARGIN_SECONDS


# One row per run, with the node it stopped in and what its ledger says it cost. The failed
# node is the last node event when that event is a start with no finish after it.
_SUMMARY = """
    select
        r.id as run_id, r.project_id, r.status,
        (r.status in ('queued', 'running') and r.created_at < %(stall_before)s) as stalled,
        r.error ->> 'reason' as reason,
        r.error ->> 'detail' as error_detail,
        case when r.status = 'failed' and last_node.kind = 'node_started'
             then last_node.node end as failed_node,
        r.created_at, r.started_at, r.finished_at,
        ledger.node_executions, ledger.priced_cost_usd, ledger.unpriced_rows
    from public.runs as r
    left join lateral (
        select e.kind, e.payload ->> 'node' as node from public.run_events as e
        where e.run_id = r.id and e.kind in ('node_started', 'node_finished')
        order by e.seq desc limit 1
    ) as last_node on true
    left join lateral (
        select count(*)::int as node_executions,
               coalesce(sum(m.cost_usd), 0) as priced_cost_usd,
               count(*) filter (where m.cost_usd is null)::int as unpriced_rows
        from public.run_node_metrics as m where m.run_id = r.id::text
    ) as ledger on true
"""


def _summary(row: dict) -> RunSummary:
    executions = row.pop("node_executions")
    priced = row.pop("priced_cost_usd")
    unpriced = row.pop("unpriced_rows")
    row.pop("error_detail", None)
    cost = (
        RunLedger(node_executions=executions, priced_cost_usd=priced, unpriced_rows=unpriced)
        if executions
        else None
    )
    return RunSummary(**row, cost=cost)


def _duration(row: dict, prefix: str) -> DurationStats:
    def whole(value: float | None) -> int | None:
        return None if value is None else round(value)

    return DurationStats(
        runs=row[f"{prefix}_runs"],
        p50_ms=whole(row[f"{prefix}_p50"]),
        p95_ms=whole(row[f"{prefix}_p95"]),
    )


async def build_run_health(
    conn: AsyncConnection, window: CostWindow, now: datetime | None = None
) -> RunHealthReport:
    now = now or datetime.now(UTC)
    since = now - WINDOW_LENGTHS[window]
    stall_after = stall_after_seconds()
    params = {
        "since": since,
        "stall_before": now - timedelta(seconds=stall_after),
        "limit": RUN_LIST_LIMIT,
    }
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "select status, count(*)::int as runs from public.runs "
            "where created_at >= %(since)s group by status",
            params,
        )
        counts = {row["status"]: row["runs"] for row in await cur.fetchall()}

        await cur.execute(
            """
            select
                count(started_at)::int as wait_runs,
                percentile_cont(0.5) within group (
                    order by extract(epoch from started_at - created_at) * 1000) as wait_p50,
                percentile_cont(0.95) within group (
                    order by extract(epoch from started_at - created_at) * 1000) as wait_p95,
                count(finished_at - started_at)::int as run_runs,
                percentile_cont(0.5) within group (
                    order by extract(epoch from finished_at - started_at) * 1000) as run_p50,
                percentile_cont(0.95) within group (
                    order by extract(epoch from finished_at - started_at) * 1000) as run_p95
            from public.runs where created_at >= %(since)s
            """,
            params,
        )
        durations = await cur.fetchone()

        await cur.execute(
            f"""
            with summaries as ({_SUMMARY} where r.created_at >= %(since)s)
            select reason, failed_node, count(*)::int as runs from summaries
            where status = 'failed'
            group by reason, failed_node order by runs desc, reason, failed_node nulls last
            """,
            params,
        )
        failures = [
            FailureGroup(
                reason=row["reason"] or "unknown",
                failed_node=row["failed_node"],
                runs=row["runs"],
            )
            for row in await cur.fetchall()
        ]

        await cur.execute(
            f"{_SUMMARY} where r.status in ('queued', 'running') "
            "and r.created_at < %(stall_before)s order by r.created_at, r.id limit %(limit)s",
            params,
        )
        stalled = [_summary(row) for row in await cur.fetchall()]

        await cur.execute(
            f"{_SUMMARY} where r.created_at >= %(since)s "
            "order by r.created_at desc, r.id limit %(limit)s",
            params,
        )
        recent = [_summary(row) for row in await cur.fetchall()]

    status_counts = StatusCounts(
        **{status: counts.get(status, 0) for status in StatusCounts.model_fields}
    )
    return RunHealthReport(
        window=window,
        since=since,
        generated_at=now,
        stall_after_seconds=stall_after,
        run_count=sum(counts.values()),
        status_counts=status_counts,
        queue_wait=_duration(durations, "wait"),
        run_time=_duration(durations, "run"),
        failures=failures,
        stalled=stalled,
        recent_runs=recent,
    )


def _steps(events: list[RunEvent]) -> list[NodeStep]:
    """Pair each node's start with its finish. Nodes run one at a time, so order pairs them."""
    steps: list[NodeStep] = []
    open_step: RunEvent | None = None
    for event in events:
        if event.kind == "node_started":
            if open_step is not None:
                steps.append(_step(open_step, None))
            open_step = event
        elif event.kind == "node_finished" and open_step is not None:
            steps.append(_step(open_step, event))
            open_step = None
    if open_step is not None:
        steps.append(_step(open_step, None))
    return steps


def _step(start: RunEvent, finish: RunEvent | None) -> NodeStep:
    return NodeStep(
        node=start.node or "unknown",
        started_at=start.created_at,
        finished_at=finish.created_at if finish else None,
        duration_ms=(finish.offset_ms - start.offset_ms) if finish else None,
    )


async def build_run_detail(
    conn: AsyncConnection, run_id: UUID, now: datetime | None = None
) -> RunDetail:
    now = now or datetime.now(UTC)
    params = {
        "run_id": run_id,
        "run_key": str(run_id),
        "stall_before": now - timedelta(seconds=stall_after_seconds()),
    }
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(f"{_SUMMARY} where r.id = %(run_id)s", params)
        row = await cur.fetchone()
        if row is None:
            raise RunNotFound
        error_detail = row["error_detail"]
        run = _summary(row)

        await cur.execute(
            """
            select e.seq, e.kind, e.payload ->> 'node' as node, e.payload ->> 'reason' as reason,
                   e.created_at,
                   greatest(0, round(extract(epoch from e.created_at - r.created_at) * 1000))::int
                       as offset_ms
            from public.run_events as e join public.runs as r on r.id = e.run_id
            where e.run_id = %(run_id)s order by e.seq
            """,
            params,
        )
        events = [RunEvent(**event) for event in await cur.fetchall()]

        await cur.execute(
            f"select node, {LEDGER_TOTALS} from public.run_node_metrics "
            "where run_id = %(run_key)s group by node order by min(started_at), node",
            params,
        )
        ledger = [NodeCost(**node) for node in await cur.fetchall()]

    return RunDetail(
        run=run, error_detail=error_detail, events=events, steps=_steps(events), ledger=ledger
    )


async def read_run_health(window: CostWindow) -> RunHealthReport:
    return await read_as_ops(lambda conn: build_run_health(conn, window))


async def read_run_detail(run_id: UUID) -> RunDetail:
    return await read_as_ops(lambda conn: build_run_detail(conn, run_id))
