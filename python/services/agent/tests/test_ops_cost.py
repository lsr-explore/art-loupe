"""The operations cost report: who may ask for it, what it reads as, and what it adds up.

The route tests fake the report. The database tests write ledger rows as `postgres` inside a
transaction that is rolled back, then switch to `artloupe_ops_reader` and aggregate them, so
they assert what the restricted role can actually see and what the SQL actually sums.
"""

import json
import os
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import httpx
import psycopg
import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from artloupe.agent import ops_routes
from artloupe.agent.ops_cost import OPS_ROLE, OpsDatabaseUnavailable, build_cost_report
from artloupe.agent.ops_cost_models import CostReport
from artloupe.auth.config import AuthSettings, get_settings
from artloupe.auth.dependencies import get_http_client, require_token

pytestmark = pytest.mark.trace(flow="ops.observability", category="functionality")

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
REQUIRE_POSTGRES = os.environ.get("ARTLOUPE_REQUIRE_POSTGRES") == "1"
FIXTURE = Path(__file__).resolve().parents[4] / "packages/schemas/fixtures/ops-cost-parity.json"
NOW = datetime(2026, 10, 7, 12, 0, tzinfo=UTC)
OWNER = "4a1f0e2c-0000-4000-8000-000000000001"


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(ops_routes.router)
    app.dependency_overrides[get_settings] = lambda: AuthSettings(
        supabase_url="http://test", supabase_anon_key="test-anon"
    )
    app.dependency_overrides[get_http_client] = lambda: None
    return app


def _as(app: FastAPI, role: str) -> None:
    app.dependency_overrides[require_token] = lambda: SimpleNamespace(role=role, subject=role)


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _sample_report() -> CostReport:
    return CostReport.model_validate(json.loads(FIXTURE.read_text())["accepts"][0])


# ---------------------------------------------------------------------------------------------
# The route
# ---------------------------------------------------------------------------------------------


@pytest.mark.trace(flow="ops.observability", category="security")
async def test_only_an_operator_may_read_costs(monkeypatch: pytest.MonkeyPatch) -> None:
    async def report(_window: str) -> CostReport:
        return _sample_report()

    monkeypatch.setattr(ops_routes, "read_cost_report", report)
    app = _app()
    async with _client(app) as client:
        assert (await client.get("/ops/costs")).status_code == 401
        _as(app, "artist")
        assert (await client.get("/ops/costs")).status_code == 403
        for role in ("operator", "superuser"):
            _as(app, role)
            assert (await client.get("/ops/costs")).status_code == 200


async def test_the_window_defaults_to_seven_days_and_is_a_closed_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    asked: list[str] = []

    async def report(window: str) -> CostReport:
        asked.append(window)
        return _sample_report()

    monkeypatch.setattr(ops_routes, "read_cost_report", report)
    app = _app()
    _as(app, "operator")
    async with _client(app) as client:
        await client.get("/ops/costs")
        await client.get("/ops/costs", params={"window": "30d"})
        assert (await client.get("/ops/costs", params={"window": "1y"})).status_code == 422

    assert asked == ["7d", "30d"]


async def test_cost_is_sent_as_a_decimal_string_not_a_float(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def report(_window: str) -> CostReport:
        return _sample_report()

    monkeypatch.setattr(ops_routes, "read_cost_report", report)
    app = _app()
    _as(app, "operator")
    async with _client(app) as client:
        body = (await client.get("/ops/costs")).json()

    assert body["totals"]["priced_cost_usd"] == "0.031500"


async def test_an_unreachable_ledger_is_a_503_not_an_empty_report(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def report(_window: str) -> CostReport:
        raise OpsDatabaseUnavailable

    monkeypatch.setattr(ops_routes, "read_cost_report", report)
    app = _app()
    _as(app, "operator")
    async with _client(app) as client:
        response = await client.get("/ops/costs")

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "30"


async def test_no_dsn_means_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    from artloupe.agent.ops_cost import read_cost_report

    monkeypatch.delenv("ARTLOUPE_OPS_DATABASE_URL", raising=False)
    with pytest.raises(OpsDatabaseUnavailable):
        await read_cost_report("7d")


@pytest.mark.trace(flow="ops.observability", category="data")
def test_shared_typescript_python_report_fixture() -> None:
    fixture = json.loads(FIXTURE.read_text())
    for value in fixture["accepts"]:
        CostReport.model_validate(value)
    for value in fixture["rejects"]:
        with pytest.raises(ValidationError):
            CostReport.model_validate(value)


# ---------------------------------------------------------------------------------------------
# Against the database, as the restricted role
# ---------------------------------------------------------------------------------------------


@pytest.fixture
async def ledger() -> psycopg.AsyncConnection:
    """A rolled-back transaction on the real Supabase stack. Skip locally, fail in CI."""
    try:
        conn = await psycopg.AsyncConnection.connect(DATABASE_URL, connect_timeout=3)
    except psycopg.Error as error:
        if REQUIRE_POSTGRES:
            pytest.fail(f"ARTLOUPE_REQUIRE_POSTGRES=1 but {DATABASE_URL} is unreachable: {error}")
        pytest.skip("no Postgres reachable -- run `pnpm supabase start`")
    present = await (
        await conn.execute("select count(*) from pg_roles where rolname = %s", (OPS_ROLE,))
    ).fetchone()
    if not present[0]:
        await conn.close()
        if REQUIRE_POSTGRES:
            pytest.fail(f"{OPS_ROLE} is missing -- the migration did not run")
        pytest.skip(f"{OPS_ROLE} is missing -- apply supabase/migrations locally")
    try:
        yield conn
    finally:
        await conn.rollback()
        await conn.close()


async def _write(
    conn: psycopg.AsyncConnection,
    run_id: str,
    node: str,
    *,
    model: str | None,
    cost: Decimal | None,
    started_at: datetime,
    attempt: int = 1,
    input_tokens: int = 0,
) -> None:
    await conn.execute(
        """
        insert into public.run_node_metrics
            (run_id, owner, node, attempt, started_at, duration_ms, status, model,
             input_tokens, cost_usd)
        values (%s, %s, %s, %s, %s, 10, 'ok', %s, %s, %s)
        """,
        (run_id, OWNER, node, attempt, started_at, model, input_tokens, cost),
    )


async def _as_reader(conn: psycopg.AsyncConnection) -> None:
    await conn.execute(f"set local role {OPS_ROLE}")


@pytest.mark.trace(flow="ops.observability", category="data")
async def test_unpriced_is_counted_beside_the_priced_sum_never_folded_into_it(
    ledger: psycopg.AsyncConnection,
) -> None:
    # A unique prefix, so rows other worktrees left in the shared database cannot match.
    run = f"ops-test-{NOW.timestamp()}"
    inside = NOW - timedelta(hours=1)
    await _write(
        ledger,
        f"{run}-a",
        "route",
        model="claude-opus-5",
        cost=Decimal("0.0200"),
        started_at=inside,
        input_tokens=1000,
    )
    await _write(
        ledger,
        f"{run}-a",
        "route",
        model="claude-opus-5",
        cost=Decimal("0.0115"),
        started_at=inside,
        attempt=2,
        input_tokens=500,
    )
    await _write(ledger, f"{run}-a", "plates", model=None, cost=Decimal("0"), started_at=inside)
    await _write(
        ledger,
        f"{run}-b",
        "route",
        model="claude-unknown-9",
        cost=None,
        started_at=inside,
        input_tokens=700,
    )
    # Outside the 24-hour window, so the totals must not include it.
    await _write(
        ledger,
        f"{run}-old",
        "route",
        model="claude-opus-5",
        cost=Decimal("9"),
        started_at=NOW - timedelta(days=3),
    )
    await _as_reader(ledger)

    report = await build_cost_report(ledger, "24h", now=NOW)
    mine_runs = [r for r in report.recent_runs if r.run_id.startswith(run)]
    by_model = {m.model: m for m in report.by_model}

    assert {r.run_id for r in mine_runs} == {f"{run}-a", f"{run}-b"}
    run_a = next(r for r in mine_runs if r.run_id == f"{run}-a")
    run_b = next(r for r in mine_runs if r.run_id == f"{run}-b")
    assert run_a.priced_cost_usd == Decimal("0.0315")
    assert run_a.unpriced_rows == 0
    assert run_a.reexecutions == 1
    assert run_b.priced_cost_usd == Decimal("0")
    assert run_b.unpriced_rows == 1, "a null cost must be counted as unpriced, not summed as 0"
    assert by_model["claude-unknown-9"].unpriced_rows >= 1
    assert None in by_model, "deterministic nodes are grouped under a null model"
    assert report.since == NOW - timedelta(hours=24)


@pytest.mark.trace(flow="ops.observability", category="security")
async def test_the_reader_role_sees_the_ledger_and_nothing_else(
    ledger: psycopg.AsyncConnection,
) -> None:
    await _as_reader(ledger)
    await ledger.execute("select count(*) from public.run_node_metrics")

    for statement in (
        "select count(*) from public.projects",
        "select count(*) from auth.users",
        "insert into public.run_node_metrics (run_id, owner, node, attempt, started_at, "
        "duration_ms, status) values ('x', 'x', 'x', 1, now(), 0, 'ok')",
        "delete from public.run_node_metrics",
    ):
        # The savepoint rolls back the refusal, so the next statement still runs as the role.
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            async with ledger.transaction():
                await ledger.execute(statement)
