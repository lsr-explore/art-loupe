"""The ledger table as it actually exists, against a real Supabase database.

`test_sinks.py` asserts what the migration *says*. This asserts what the database *does*,
which is a different claim and the one that matters: a table can be created in `public` with
row-level security enabled and still be readable, if a grant or a policy says so.

Needs the Supabase stack rather than a bare Postgres, for the same reason
`libs/persistence/tests/test_schema_privileges.py` does: `anon` and `authenticated` are
Supabase-provisioned roles. Against stock Postgres these assertions would pass while testing
nothing, so the control below proves the grants being guarded against are live here.
"""

import os
from datetime import UTC, datetime
from decimal import Decimal

import psycopg
import pytest

from artloupe.metering.records import NodeMetric
from artloupe.metering.sinks import PostgresMetricsSink

pytestmark = pytest.mark.trace(flow="ops.observability", category="security")

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
REQUIRE_POSTGRES = os.environ.get("ARTLOUPE_REQUIRE_POSTGRES") == "1"

# The roles PostgREST assumes for an unauthenticated and a logged-in caller.
API_ROLES = ("anon", "authenticated")
TABLE = "public.run_node_metrics"


def _connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, connect_timeout=3)


@pytest.fixture(scope="module", autouse=True)
def supabase_database_required() -> None:
    """Skip on a bare Postgres locally; fail on one in CI."""
    try:
        with _connect() as conn:
            present = conn.execute(
                "select count(*) from pg_roles where rolname = any(%s)", (list(API_ROLES),)
            ).fetchone()[0]
    except psycopg.Error as error:
        if REQUIRE_POSTGRES:
            pytest.fail(f"ARTLOUPE_REQUIRE_POSTGRES=1 but {DATABASE_URL} is unreachable: {error}")
        pytest.skip("no Postgres reachable -- run `pnpm supabase start`")

    if present == len(API_ROLES):
        return
    if REQUIRE_POSTGRES:
        pytest.fail(
            f"ARTLOUPE_REQUIRE_POSTGRES=1 but {DATABASE_URL} has no {'/'.join(API_ROLES)} roles. "
            "That is a stock Postgres, not the Supabase stack, and every assertion in this "
            "file would pass against roles that do not exist."
        )
    pytest.skip("not a Supabase database -- run `pnpm supabase start`, not a bare postgres")


def test_the_grants_this_table_is_protected_from_are_live_here() -> None:
    """The control. Supabase grants `anon` SELECT on tables created in `public` by default.

    Without this, "anon cannot read run_node_metrics" could be true because nothing in
    `public` is readable, which would make the real assertion vacuous.
    """
    with _connect() as conn:
        conn.execute("create table if not exists public.metrics_control_probe (id int)")
        try:
            readable = {
                role: conn.execute(
                    "select has_table_privilege(%s, 'public.metrics_control_probe', 'SELECT')",
                    (role,),
                ).fetchone()[0]
                for role in API_ROLES
            }
        finally:
            conn.execute("drop table if exists public.metrics_control_probe")
        conn.commit()

    assert all(readable.values()), (
        f"expected {'/'.join(API_ROLES)} to read a fresh table in `public`, got {readable}. "
        "Without that, this file's other assertions prove nothing."
    )


def test_row_level_security_is_on_and_no_policy_opens_it() -> None:
    """Enabling RLS with no policy is the entire protection — both halves have to hold."""
    with _connect() as conn:
        enabled = conn.execute(
            "select relrowsecurity from pg_class where oid = %s::regclass", (TABLE,)
        ).fetchone()[0]
        policies = conn.execute(
            "select policyname from pg_policies where schemaname = 'public' "
            "and tablename = 'run_node_metrics'"
        ).fetchall()

    assert enabled, f"{TABLE} has row-level security off — every row is readable"
    assert not policies, f"{TABLE} has policies that grant rows to API roles: {policies}"


def test_the_api_roles_cannot_read_the_ledger() -> None:
    """The outcome the placement is for: the anon key is published, so this must deny it."""
    with _connect() as conn:
        readable = {
            role: conn.execute(
                "select has_table_privilege(%s, %s, 'SELECT')", (role, TABLE)
            ).fetchone()[0]
            for role in API_ROLES
        }

    assert not any(readable.values()), (
        f"{'/'.join(API_ROLES)} can read {TABLE}: {readable}. The ledger records which artist "
        "ran what and what it cost."
    )


@pytest.mark.trace(flow="ops.observability", category="data")
async def test_a_flushed_run_is_readable_afterwards() -> None:
    """The round trip the operations dashboard depends on.

    Asserted against the live column types rather than a mock, because the interesting failure
    is a mismatch between the Pydantic record and the DDL — a `Decimal` into a column that is
    not numeric, or a field the insert forgot.
    """
    run_id = f"test-{datetime.now(UTC).timestamp()}"
    metric = NodeMetric(
        run_id=run_id,
        owner="4a1f0e2c-0000-4000-8000-000000000001",
        node="analyse",
        attempt=1,
        started_at=datetime.now(UTC),
        duration_ms=42,
        status="ok",
        model="claude-opus-5",
        input_tokens=1_000,
        output_tokens=500,
        cache_read_tokens=200,
        tool_calls=1,
        cost_usd=Decimal("0.0176"),
    )

    try:
        await PostgresMetricsSink(DATABASE_URL).flush([metric])
        with _connect() as conn:
            row = conn.execute(
                "select node, attempt, duration_ms, status, model, input_tokens, "
                f"output_tokens, cache_read_tokens, tool_calls, cost_usd from {TABLE} "
                "where run_id = %s",
                (run_id,),
            ).fetchall()
    finally:
        with _connect() as conn:
            conn.execute(f"delete from {TABLE} where run_id = %s", (run_id,))
            conn.commit()

    assert row == [
        ("analyse", 1, 42, "ok", "claude-opus-5", 1_000, 500, 200, 1, Decimal("0.017600"))
    ]
