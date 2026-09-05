"""Where the ledger goes, and what it is protected by when it gets there.

The Postgres round trip is `test_metrics_table.py`, which needs a real Supabase database.
Everything here runs without one.
"""

from pathlib import Path

import pytest

from artloupe.metering.config import MeteringSettings, get_settings
from artloupe.metering.sinks import (
    METRICS_TABLE,
    InMemoryMetricsSink,
    PostgresMetricsSink,
    get_metrics_sink,
)

pytestmark = pytest.mark.trace(flow="ops.observability", category="functionality")

MIGRATION = (
    Path(__file__).resolve().parents[4]
    / "supabase"
    / "migrations"
    / "20260905120000_create_run_node_metrics.sql"
)


@pytest.fixture(autouse=True)
def clean_settings() -> None:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_defaults_to_memory_so_tests_stay_hermetic() -> None:
    """A unit test must not need a database to run a graph."""
    assert isinstance(get_metrics_sink(), InMemoryMetricsSink)


def test_postgres_mode_is_opt_in() -> None:
    sink = get_metrics_sink(MeteringSettings(artloupe_metering="postgres"))
    assert isinstance(sink, PostgresMetricsSink)


async def test_flushing_nothing_opens_no_connection() -> None:
    """A run with no nodes must not cost a connection, and must not fail without a database."""
    await PostgresMetricsSink("postgresql://nowhere:1/none").flush([])


@pytest.mark.trace(flow="ops.observability", category="security")
def test_the_ledger_table_is_denied_to_the_api_roles_by_construction() -> None:
    """The migration's protection, asserted where it can fail review rather than in prose.

    This table is deliberately in `public` — its only consumer reads through PostgREST — so
    unlike the checkpoint tables it is *reachable*, and what keeps it private is row-level
    security with no policy plus a revoked grant. Adding `create policy ... using (true)` is a
    one-line edit that would open the whole ledger to anyone holding the anon key, which is a
    published value. `test_metrics_table.py` asserts the live outcome; this catches the edit.
    """
    sql = MIGRATION.read_text(encoding="utf-8")
    assert "enable row level security" in sql
    assert "revoke all on public.run_node_metrics from anon, authenticated;" in sql
    assert "create policy" not in sql, (
        "a policy on run_node_metrics would grant the API roles rows they currently cannot "
        "see at all — if one is genuinely wanted, it belongs with the `runs` table and its "
        "owner scoping, not here"
    )


def test_the_sink_writes_where_the_migration_creates() -> None:
    """Two files, one table name. A rename in either is silent until a run tries to flush."""
    assert METRICS_TABLE == "public.run_node_metrics"
    assert "create table if not exists public.run_node_metrics" in MIGRATION.read_text(
        encoding="utf-8"
    )
