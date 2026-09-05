"""The spike: an interrupted run resumes in a different process.

This is the test PR 3 exists for. FR-402/403/404 require that a run pause for artist
correction and continue afterwards, and neither this repo nor `veloce-trace` had ever proved
that mechanism worked — no `interrupt()`, no checkpointer, no resume, anywhere.

It runs the graph in **two separate `python` processes** rather than two `ainvoke` calls in
one. That distinction is the entire point: an in-process resume passes with an in-memory
saver and proves nothing about durability, so it would give exactly the false confidence this
PR is meant to remove.
"""

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg
import pytest

from artloupe.persistence import CHECKPOINT_SCHEMA

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")

SPIKE = Path(__file__).parent / "spike_runner.py"
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
# CI sets this. Without it a developer with no local Postgres gets a skip; with it, an
# unreachable database is a failure — so a broken CI service container can never masquerade
# as a green run by silently skipping the only test that proves durability.
REQUIRE_POSTGRES = os.environ.get("ARTLOUPE_REQUIRE_POSTGRES") == "1"


def _postgres_available() -> bool:
    try:
        with psycopg.connect(DATABASE_URL, connect_timeout=3):
            return True
    except Exception:
        return False


@pytest.fixture(scope="module", autouse=True)
def postgres_required() -> None:
    if _postgres_available():
        return
    if REQUIRE_POSTGRES:
        pytest.fail(
            f"ARTLOUPE_REQUIRE_POSTGRES=1 but {DATABASE_URL} is unreachable. "
            "This is the only test proving resume survives a process restart; skipping it "
            "silently would defeat the purpose."
        )
    pytest.skip("no Postgres reachable — run `pnpm supabase start` to exercise this test")


def _run_spike(*args: str) -> dict:
    """Invoke the spike as a genuinely separate process and read its JSON result."""
    completed = subprocess.run(
        [sys.executable, str(SPIKE), *args],
        capture_output=True,
        text=True,
        timeout=120,
        env={**os.environ, "ARTLOUPE_PERSISTENCE": "postgres", "DATABASE_URL": DATABASE_URL},
    )
    assert completed.returncode == 0, f"spike failed:\n{completed.stderr}"
    return json.loads(completed.stdout.strip().splitlines()[-1])


async def test_run_resumes_in_a_different_process() -> None:
    thread = f"test-{uuid.uuid4()}"

    started = _run_spike("start", thread)
    assert started["pending"] == ["await_correction"], "the run should be paused, not finished"
    assert started["corrected"] == ""

    # Nothing is shared with the process above except the database.
    resumed = _run_spike("resume", thread, "vp=1204,388")
    assert resumed["pending"] == [], "the run should have completed"
    assert resumed["corrected"] == "vp=1204,388"


async def test_resume_does_not_re_run_the_node_before_the_interrupt() -> None:
    """The hazard that makes node layout load-bearing.

    On resume LangGraph re-runs the *whole node* containing `interrupt()` from the top. If
    `propose` and the interrupt shared a node, `propose`'s side effect would fire twice — and
    when that side effect is a metering increment, the budget ledger (NFR-04) silently
    double-charges every corrected run.
    """
    thread = f"test-{uuid.uuid4()}"
    _run_spike("start", thread)
    resumed = _run_spike("resume", thread, "vp=90,90")

    proposals = [entry for entry in resumed["side_effects"] if entry.startswith("proposed:")]
    assert len(proposals) == 1, f"propose ran {len(proposals)} times, expected once"
    assert resumed["side_effects"][-1] == "applied:vp=90,90"


async def test_the_artist_correction_is_what_the_run_continues_with() -> None:
    """A resume that ignored the supplied value would still look like a working resume."""
    thread = f"test-{uuid.uuid4()}"
    _run_spike("start", thread)
    resumed = _run_spike("resume", thread, "horizon=0.42")
    assert resumed["corrected"] == "horizon=0.42"


@pytest.mark.trace(flow="platform.agent-runtime", category="security")
async def test_checkpoints_are_written_outside_the_api_exposed_schemas() -> None:
    """Asserted against the live database, not just the connection string.

    `supabase/config.toml` exposes `public` and `graphql_public` through PostgREST, so a
    checkpoint table landing in either is readable by anyone holding the anon key.
    """
    thread = f"test-{uuid.uuid4()}"
    _run_spike("start", thread)

    with psycopg.connect(DATABASE_URL) as conn:
        in_schema = conn.execute(
            "select count(*) from pg_tables where schemaname = %s and tablename = 'checkpoints'",
            (CHECKPOINT_SCHEMA,),
        ).fetchone()[0]
        exposed = conn.execute(
            "select count(*) from pg_tables "
            "where schemaname in ('public', 'graphql_public') and tablename like '%checkpoint%'"
        ).fetchone()[0]

    assert in_schema == 1, f"checkpoints table missing from the {CHECKPOINT_SCHEMA} schema"
    assert exposed == 0, "checkpoint tables leaked into an API-exposed schema"
