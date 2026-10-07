"""Runs are written only by the recorder, only through its functions, and read only by their owner.

`public.runs` and `public.run_events` sit in the API-exposed schema so the agent can read them as
the artist. That makes two boundaries worth proving rather than assuming:

- **The write path.** The artist's token must not be able to change run state at all, or an
  artist could forge their own run's result. Only `artloupe_run_recorder` may write, and only by
  executing the two functions, which refuse every illegal transition.
- **The read path.** RLS confines an artist to their own runs, as it does for projects.

As elsewhere in this directory, every denial is paired with a control, and every write is rolled
back with the test's transaction.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
import pytest
from db_support import (
    ANON,
    ARTIST_A,
    ARTIST_B,
    AUTHENTICATED,
    PROJECT_A,
    PROJECT_B,
    acting_as,
    count,
    refused,
)
from psycopg.types.json import Jsonb
from test_run_log import TRANSITIONS

from artloupe.persistence import PROJECTS_TABLE, RUN_EVENTS_TABLE, RUNS_TABLE

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="security")

RECORDER = "artloupe_run_recorder"
RUN = "44444444-4444-4444-8444-444444444444"

CREATE = "select public.artloupe_run_create(%s, %s, %s)"
RECORD = "select public.artloupe_run_record(%s, %s, %s)"


@contextmanager
def as_recorder(conn: psycopg.Connection) -> Iterator[psycopg.Connection]:
    """Narrow the connection to the recorder role, as `PostgresRunLog` does."""
    conn.execute(f"set local role {RECORDER}")
    try:
        yield conn
    finally:
        conn.execute("reset role")


def create_run(conn: psycopg.Connection, project: str = PROJECT_A, owner: str = ARTIST_A) -> None:
    with as_recorder(conn):
        conn.execute(CREATE, (RUN, project, owner))


def record(conn: psycopg.Connection, kind: str, payload: dict | None = None) -> int:
    with as_recorder(conn):
        return conn.execute(RECORD, (RUN, kind, Jsonb(payload or {}))).fetchone()[0]


def refused_as_recorder(
    conn: psycopg.Connection, statement: str, params: tuple, error: type[psycopg.Error]
) -> None:
    """Expect the recorder to be refused. The savepoint sits inside the role switch, so resetting
    the role never runs in an aborted transaction."""
    with as_recorder(conn), refused(conn, error):
        conn.execute(statement, params)


# ---------------------------------------------------------------------------------------------
# The recorder's write path
# ---------------------------------------------------------------------------------------------


def test_the_recorder_creates_a_queued_run_for_the_owners_project(
    two_artists: psycopg.Connection,
) -> None:
    create_run(two_artists)

    status, owner = two_artists.execute(
        f"select status, owner_id::text from {RUNS_TABLE} where id = %s", (RUN,)
    ).fetchone()
    assert (status, owner) == ("queued", ARTIST_A)


@pytest.mark.parametrize(
    "project", [PROJECT_B, "cccccccc-5555-4555-8555-cccccccccccc"], ids=["foreign", "absent"]
)
def test_a_project_that_is_not_the_owners_is_refused_like_an_absent_one(
    two_artists: psycopg.Connection, project: str
) -> None:
    refused_as_recorder(two_artists, CREATE, (RUN, project, ARTIST_A), psycopg.errors.NoDataFound)


def test_a_finished_run_records_its_events_gaplessly_and_its_result(
    two_artists: psycopg.Connection,
) -> None:
    create_run(two_artists)
    seqs = [
        record(two_artists, "started"),
        record(two_artists, "node_started", {"node": "load_project"}),
        record(two_artists, "node_finished", {"node": "load_project"}),
        record(two_artists, "succeeded", {"run_id": RUN}),
    ]

    assert seqs == [1, 2, 3, 4]
    status, result, last_seq, finished = two_artists.execute(
        f"select status, result, last_seq, finished_at is not null from {RUNS_TABLE} where id = %s",
        (RUN,),
    ).fetchone()
    assert (status, result, last_seq, finished) == ("succeeded", {"run_id": RUN}, 4, True)


@pytest.mark.parametrize(("history", "kind", "accepted"), TRANSITIONS)
def test_transitions_match_the_in_memory_log(
    two_artists: psycopg.Connection, history: tuple[str, ...], kind: str, accepted: bool
) -> None:
    create_run(two_artists)
    for earlier in history:
        record(two_artists, earlier)

    if accepted:
        assert record(two_artists, kind) == len(history) + 1
    else:
        refused_as_recorder(
            two_artists, RECORD, (RUN, kind, Jsonb({})), psycopg.errors.RestrictViolation
        )


@pytest.mark.parametrize("verb", ["SELECT", "INSERT", "UPDATE", "DELETE"])
@pytest.mark.parametrize("table", [RUNS_TABLE, RUN_EVENTS_TABLE])
def test_the_recorder_holds_no_table_privilege(
    db: psycopg.Connection, table: str, verb: str
) -> None:
    """It can only execute the functions, so the transition rules cannot be stepped around."""
    held = db.execute("select has_table_privilege(%s, %s, %s)", (RECORDER, table, verb)).fetchone()
    assert held[0] is False


# ---------------------------------------------------------------------------------------------
# The API roles
# ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize("role", [ANON, AUTHENTICATED])
@pytest.mark.parametrize(
    "function",
    ["public.artloupe_run_create(uuid,uuid,uuid)", "public.artloupe_run_record(uuid,text,jsonb)"],
)
def test_no_api_role_can_execute_the_recorder_functions(
    db: psycopg.Connection, role: str, function: str
) -> None:
    """Supabase grants EXECUTE on new `public` functions by default; the migration revokes it."""
    held = db.execute("select has_function_privilege(%s, %s, 'EXECUTE')", (role, function))
    assert held.fetchone()[0] is False


def test_the_recorder_can_execute_them(db: psycopg.Connection) -> None:
    """The control for the test above."""
    held = db.execute(
        "select has_function_privilege(%s, 'public.artloupe_run_record(uuid,text,jsonb)', "
        "'EXECUTE')",
        (RECORDER,),
    )
    assert held.fetchone()[0] is True


@pytest.mark.parametrize("table", [RUNS_TABLE, RUN_EVENTS_TABLE])
def test_authenticated_may_select_and_nothing_else(db: psycopg.Connection, table: str) -> None:
    held = {
        verb: db.execute(
            "select has_table_privilege(%s, %s, %s)", (AUTHENTICATED, table, verb)
        ).fetchone()[0]
        for verb in ("SELECT", "INSERT", "UPDATE", "DELETE")
    }
    assert held == {"SELECT": True, "INSERT": False, "UPDATE": False, "DELETE": False}


@pytest.mark.parametrize("table", [RUNS_TABLE, RUN_EVENTS_TABLE])
def test_anon_holds_nothing(db: psycopg.Connection, table: str) -> None:
    held = db.execute("select has_table_privilege(%s, %s, 'SELECT')", (ANON, table))
    assert held.fetchone()[0] is False


def test_an_artist_cannot_rewrite_their_own_runs_result(two_artists: psycopg.Connection) -> None:
    """The forgery this design exists to prevent."""
    create_run(two_artists)
    record(two_artists, "started")

    with acting_as(two_artists, AUTHENTICATED, ARTIST_A), refused(two_artists):
        two_artists.execute(f"update {RUNS_TABLE} set status = 'succeeded' where id = %s", (RUN,))


def test_an_artist_sees_their_own_run_and_its_events(two_artists: psycopg.Connection) -> None:
    create_run(two_artists)
    record(two_artists, "started")

    with acting_as(two_artists, AUTHENTICATED, ARTIST_A):
        assert count(two_artists, f"select count(*) from {RUNS_TABLE} where id = %s", (RUN,)) == 1
        assert (
            count(two_artists, f"select count(*) from {RUN_EVENTS_TABLE} where run_id = %s", (RUN,))
            == 1
        )


def test_another_artist_sees_neither(two_artists: psycopg.Connection) -> None:
    create_run(two_artists)
    record(two_artists, "started")

    with acting_as(two_artists, AUTHENTICATED, ARTIST_B):
        assert count(two_artists, f"select count(*) from {RUNS_TABLE} where id = %s", (RUN,)) == 0
        assert (
            count(two_artists, f"select count(*) from {RUN_EVENTS_TABLE} where run_id = %s", (RUN,))
            == 0
        )


@pytest.mark.trace(flow="platform.agent-runtime", category="privacy")
def test_runs_and_events_leave_with_their_project(two_artists: psycopg.Connection) -> None:
    """FR-806: deleting the project is complete without a change to the deletion path."""
    create_run(two_artists)
    record(two_artists, "started")

    two_artists.execute(f"delete from {PROJECTS_TABLE} where id = %s", (PROJECT_A,))

    assert count(two_artists, f"select count(*) from {RUNS_TABLE} where id = %s", (RUN,)) == 0
    assert (
        count(two_artists, f"select count(*) from {RUN_EVENTS_TABLE} where run_id = %s", (RUN,))
        == 0
    )
