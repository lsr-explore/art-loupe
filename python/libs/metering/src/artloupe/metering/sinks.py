"""Where a finished run's ledger goes.

`InMemoryMetricsSink` is the default so unit tests and CI stay hermetic without every caller
branching on configuration — the same rule `artloupe.persistence` follows for checkpoints, and
for the same reason: a unit test should not need a database.

`PostgresMetricsSink` is the one operations actually reads (FR-905). Three decisions:

- **`public`, with row-level security and no policy.** Unlike the checkpoint tables, this one
  has to be *readable* by the operations dashboard, which reaches Postgres through PostgREST —
  so hiding it in an unexposed schema would hide it from its only consumer. RLS with no policy
  denies `anon` and `authenticated` outright while `service_role`, which operations holds,
  bypasses RLS. The migration is
  `supabase/migrations/20260905120000_create_run_node_metrics.sql`.
- **One connection per flush, no pool.** A run flushes once, when it ends. A pooled connection
  held for the length of a run would cost more than it saves and would have to be torn down on
  every code path that ends a run, including the ones that raise.
- **A failed flush must not fail the run.** Losing an operations row is bad; discarding an
  artist's completed analysis because a metrics insert timed out is worse. `flush` raises and
  `artloupe.agent.runtime` is what decides to swallow it — the decision belongs where the run
  is, not here.
"""

from collections.abc import Sequence
from typing import Protocol

from artloupe.metering.config import MeteringSettings, get_settings
from artloupe.metering.records import NodeMetric

# Deliberately in `public`: the operations dashboard reads this through PostgREST, and a schema
# PostgREST does not expose is unreadable by its only consumer. Access is denied by RLS instead.
METRICS_TABLE = "public.run_node_metrics"

_INSERT = f"""
insert into {METRICS_TABLE} (
    run_id, owner, node, attempt, started_at, duration_ms, status, model,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    tool_calls, cost_usd, error
) values (
    %(run_id)s, %(owner)s, %(node)s, %(attempt)s, %(started_at)s, %(duration_ms)s,
    %(status)s, %(model)s, %(input_tokens)s, %(output_tokens)s, %(cache_read_tokens)s,
    %(cache_write_tokens)s, %(tool_calls)s, %(cost_usd)s, %(error)s
)
"""


class MetricsSink(Protocol):
    """Somewhere a run's per-node rows can be written."""

    async def flush(self, metrics: Sequence[NodeMetric]) -> None: ...


class InMemoryMetricsSink:
    """Keeps rows in the process. Correct for tests, and useless to operations."""

    def __init__(self) -> None:
        self.metrics: list[NodeMetric] = []

    async def flush(self, metrics: Sequence[NodeMetric]) -> None:
        self.metrics.extend(metrics)


class PostgresMetricsSink:
    """Writes rows to `public.run_node_metrics`."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def flush(self, metrics: Sequence[NodeMetric]) -> None:
        if not metrics:
            return

        from psycopg import AsyncConnection

        rows = [metric.model_dump() for metric in metrics]
        async with await AsyncConnection.connect(self._database_url) as conn:
            # One transaction for the whole run: a half-written ledger is a worse artifact
            # than a missing one, because it looks complete.
            async with conn.cursor() as cursor:
                await cursor.executemany(_INSERT, rows)
            await conn.commit()


def get_metrics_sink(settings: MeteringSettings | None = None) -> MetricsSink:
    """The configured sink — in-memory unless `ARTLOUPE_METERING=postgres`."""
    resolved = settings or get_settings()
    if not resolved.persistence_enabled:
        return InMemoryMetricsSink()
    return PostgresMetricsSink(resolved.database_url)
