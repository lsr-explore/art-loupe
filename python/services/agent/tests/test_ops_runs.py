"""Run health (FR-901): what the operations report counts, and what its role cannot see.

The database tests seed runs as `postgres` inside a rolled-back transaction, then read them as
`artloupe_ops_reader`. Every timestamp sits in 2099, so the window holds only these rows and
real runs in the shared database cannot change a count.
"""

import json
import os
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import httpx
import psycopg
import pytest
from fastapi import FastAPI
from psycopg.types.json import Jsonb

from artloupe.agent import ops_routes
from artloupe.agent.ops_db import OPS_ROLE, OpsDatabaseUnavailable
from artloupe.agent.ops_runs import RunNotFound, build_run_detail, build_run_health
from artloupe.agent.ops_runs_models import RunDetail, RunHealthReport
from artloupe.auth.config import AuthSettings, get_settings
from artloupe.auth.dependencies import get_http_client, require_token

pytestmark = pytest.mark.trace(flow="ops.observability", category="functionality")

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
REQUIRE_POSTGRES = os.environ.get("ARTLOUPE_REQUIRE_POSTGRES") == "1"
NOW = datetime(2099, 1, 1, 12, 0, tzinfo=UTC)
OWNER = UUID("cccccccc-5555-4555-8555-cccccccccccc")
PROJECT = UUID("cccccccc-6666-4666-8666-cccccccccccc")

FIXTURE = Path(__file__).resolve().parents[4] / "packages/schemas/fixtures/ops-runs-parity.json"


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(ops_routes.router)
    app.dependency_overrides[get_settings] = lambda: AuthSettings(
        supabase_url="http://test", supabase_anon_key="test-anon"
    )
    app.dependency_overrides[get_http_client] = lambda: None
    return app


def _client(app: FastAPI, role: str | None) -> httpx.AsyncClient:
    if role:
        app.dependency_overrides[require_token] = lambda: SimpleNamespace(role=role, subject=role)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _fixture() -> dict:
    return json.loads(FIXTURE.read_text())


# ---------------------------------------------------------------------------------------------
# The routes
# ---------------------------------------------------------------------------------------------


@pytest.mark.trace(flow="ops.observability", category="security")
async def test_only_an_operator_may_read_run_health(monkeypatch: pytest.MonkeyPatch) -> None:
    async def health(_window: str) -> RunHealthReport:
        return RunHealthReport.model_validate(_fixture()["health"]["accepts"][0])

    monkeypatch.setattr(ops_routes, "read_run_health", health)
    app = _app()
    async with _client(app, None) as client:
        assert (await client.get("/ops/runs")).status_code == 401
    async with _client(app, "artist") as client:
        assert (await client.get("/ops/runs")).status_code == 403
        assert (await client.get(f"/ops/runs/{uuid4()}")).status_code == 403
    async with _client(app, "operator") as client:
        assert (await client.get("/ops/runs")).status_code == 200


async def test_an_unknown_run_is_a_404_and_a_malformed_id_a_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def detail(_run_id: UUID) -> RunDetail:
        raise RunNotFound

    monkeypatch.setattr(ops_routes, "read_run_detail", detail)
    async with _client(_app(), "operator") as client:
        assert (await client.get(f"/ops/runs/{uuid4()}")).status_code == 404
        assert (await client.get("/ops/runs/not-a-uuid")).status_code == 422


async def test_an_unreachable_database_is_a_503(monkeypatch: pytest.MonkeyPatch) -> None:
    async def health(_window: str) -> RunHealthReport:
        raise OpsDatabaseUnavailable

    monkeypatch.setattr(ops_routes, "read_run_health", health)
    async with _client(_app(), "operator") as client:
        response = await client.get("/ops/runs")

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "30"


@pytest.mark.trace(flow="ops.observability", category="data")
def test_shared_typescript_python_run_fixtures() -> None:
    fixture = _fixture()
    for model, key in ((RunHealthReport, "health"), (RunDetail, "detail")):
        for value in fixture[key]["accepts"]:
            model.model_validate(value)
        for value in fixture[key]["rejects"]:
            with pytest.raises(ValueError):
                model.model_validate(value)


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
    granted = await (
        await conn.execute(
            "select has_table_privilege(%s, 'public.run_events', 'SELECT')", (OPS_ROLE,)
        )
    ).fetchone()
    if not granted[0]:
        await conn.close()
        if REQUIRE_POSTGRES:
            pytest.fail(f"{OPS_ROLE} cannot read run_events -- the migration did not run")
        pytest.skip(f"{OPS_ROLE} cannot read run_events -- apply supabase/migrations locally")
    try:
        yield conn
    finally:
        await conn.rollback()
        await conn.close()


async def _run(
    conn: psycopg.AsyncConnection,
    *,
    status: str,
    created: datetime,
    started: datetime | None = None,
    finished: datetime | None = None,
    error: dict | None = None,
    events: list[tuple[str, dict]] = (),
) -> UUID:
    run_id = uuid4()
    await conn.execute(
        """
        insert into public.runs
            (id, project_id, owner_id, status, error, result, last_seq,
             created_at, started_at, finished_at)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            run_id,
            PROJECT,
            OWNER,
            status,
            Jsonb(error) if error else None,
            Jsonb({"routing": "private"}) if status == "succeeded" else None,
            len(events),
            created,
            started,
            finished,
        ),
    )
    for seq, (kind, payload) in enumerate(events, start=1):
        await conn.execute(
            "insert into public.run_events (run_id, seq, kind, payload, created_at) "
            "values (%s, %s, %s, %s, %s)",
            (run_id, seq, kind, Jsonb(payload), created + timedelta(seconds=seq)),
        )
    return run_id


@pytest.fixture
async def seeded(ledger: psycopg.AsyncConnection) -> dict[str, UUID]:
    await ledger.execute(
        "insert into auth.users (id, email) values (%s, 'ops-runs@artloupe.test')", (OWNER,)
    )
    await ledger.execute(
        "insert into public.projects (id, owner_id, intent) values (%s, %s, %s)",
        (PROJECT, OWNER, Jsonb({"medium": "oil", "time_budget_minutes": 90})),
    )
    succeeded_at = NOW - timedelta(hours=2)
    runs = {
        "succeeded": await _run(
            ledger,
            status="succeeded",
            created=succeeded_at,
            started=succeeded_at + timedelta(seconds=1),
            finished=succeeded_at + timedelta(seconds=11),
            events=[
                ("started", {}),
                ("node_started", {"node": "route"}),
                ("node_finished", {"node": "route"}),
                ("succeeded", {}),
            ],
        ),
        "failed_in_node": await _run(
            ledger,
            status="failed",
            created=NOW - timedelta(hours=1),
            started=NOW - timedelta(hours=1) + timedelta(seconds=2),
            finished=NOW - timedelta(hours=1) + timedelta(seconds=5),
            error={"reason": "deadline_exceeded", "detail": "The run ran out of time."},
            events=[
                ("started", {}),
                ("node_started", {"node": "route"}),
                ("node_finished", {"node": "route"}),
                ("node_started", {"node": "plates"}),
                ("failed", {"reason": "deadline_exceeded", "detail": "out of time"}),
            ],
        ),
        "failed_queued": await _run(
            ledger,
            status="failed",
            created=NOW - timedelta(minutes=30),
            finished=NOW - timedelta(minutes=30),
            error={"reason": "project_not_found", "detail": "Project not found."},
            events=[("failed", {"reason": "project_not_found", "detail": "Project not found."})],
        ),
        "running": await _run(
            ledger,
            status="running",
            created=NOW - timedelta(seconds=30),
            started=NOW - timedelta(seconds=29),
            events=[("started", {})],
        ),
        "stuck": await _run(
            ledger,
            status="running",
            created=NOW - timedelta(days=3),
            started=NOW - timedelta(days=3),
            events=[("started", {})],
        ),
    }
    await ledger.execute(
        "insert into public.run_node_metrics (run_id, owner, node, attempt, started_at, "
        "duration_ms, status, model, cost_usd) "
        "values (%s, %s, 'route', 1, %s, 10000, 'ok', 'claude-opus-5', 0.0200)",
        (str(runs["succeeded"]), str(OWNER), succeeded_at),
    )
    await ledger.execute(f"set local role {OPS_ROLE}")
    return runs


@pytest.mark.trace(flow="ops.observability", category="data")
async def test_run_health_counts_reasons_and_durations(
    ledger: psycopg.AsyncConnection, seeded: dict[str, UUID]
) -> None:
    report = await build_run_health(ledger, "24h", now=NOW)

    assert report.run_count == 4, "the stuck run predates the window and is not counted"
    assert report.status_counts.model_dump() == {
        "queued": 0,
        "running": 1,
        "succeeded": 1,
        "failed": 2,
    }
    assert [(f.reason, f.failed_node, f.runs) for f in report.failures] == [
        ("deadline_exceeded", "plates", 1),
        ("project_not_found", None, 1),
    ]
    assert report.run_time.runs == 2
    assert report.run_time.p50_ms == 6500  # median of 10 s and 3 s
    assert report.queue_wait.runs == 3  # the run that failed while queued never started
    assert [r.run_id for r in report.recent_runs] == [
        seeded["running"],
        seeded["failed_queued"],
        seeded["failed_in_node"],
        seeded["succeeded"],
    ]


async def test_a_run_past_its_deadline_is_stalled_whatever_the_window(
    ledger: psycopg.AsyncConnection, seeded: dict[str, UUID]
) -> None:
    report = await build_run_health(ledger, "24h", now=NOW)

    assert [r.run_id for r in report.stalled] == [seeded["stuck"]]
    assert report.stalled[0].stalled
    assert not next(r for r in report.recent_runs if r.run_id == seeded["running"]).stalled


@pytest.mark.trace(flow="ops.observability", category="data")
async def test_a_run_carries_its_ledger_once_it_has_one(
    ledger: psycopg.AsyncConnection, seeded: dict[str, UUID]
) -> None:
    report = await build_run_health(ledger, "24h", now=NOW)
    runs = {r.run_id: r for r in report.recent_runs}

    assert runs[seeded["succeeded"]].cost.priced_cost_usd == Decimal("0.0200")
    assert runs[seeded["failed_in_node"]].cost is None


async def test_the_drill_down_pairs_nodes_and_names_where_it_stopped(
    ledger: psycopg.AsyncConnection, seeded: dict[str, UUID]
) -> None:
    detail = await build_run_detail(ledger, seeded["failed_in_node"], now=NOW)

    assert detail.run.failed_node == "plates"
    assert detail.error_detail == "The run ran out of time."
    assert [e.kind for e in detail.events] == [
        "started",
        "node_started",
        "node_finished",
        "node_started",
        "failed",
    ]
    assert [(s.node, s.duration_ms) for s in detail.steps] == [("route", 1000), ("plates", None)]
    assert detail.events[-1].reason == "deadline_exceeded"


async def test_an_unknown_run_is_not_found(
    ledger: psycopg.AsyncConnection, seeded: dict[str, UUID]
) -> None:
    with pytest.raises(RunNotFound):
        await build_run_detail(ledger, uuid4(), now=NOW)


@pytest.mark.trace(flow="ops.observability", category="privacy")
async def test_the_reader_cannot_see_a_runs_result_or_its_owner(
    ledger: psycopg.AsyncConnection, seeded: dict[str, UUID]
) -> None:
    await ledger.execute("select id, status, project_id from public.runs limit 1")
    for column in ("result", "owner_id"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            async with ledger.transaction():
                await ledger.execute(f"select {column} from public.runs limit 1")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with ledger.transaction():
            await ledger.execute("select count(*) from public.projects")
