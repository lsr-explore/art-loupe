"""The node cache keeps one artist's results from another, and each result on its own photograph.

`public.tool_results` sits in the API-exposed schema because the agent reads and writes it as the
artist. Row-level security is therefore the whole boundary, as it is for `projects`. As in
`test_projects_rls.py`, every denial here is paired with a control, because "the query returned
nothing" is also what a missing grant, a typo, or an empty table returns.
"""

from __future__ import annotations

import psycopg
import pytest
from db_support import (
    ANON,
    ARTIST_A,
    ARTIST_B,
    AUTHENTICATED,
    CHECKSUM_A,
    CHECKSUM_B,
    PROJECT_A,
    PROJECT_B,
    acting_as,
    count,
    refused,
)
from psycopg.types.json import Jsonb

from artloupe.persistence import PROJECTS_TABLE, TOOL_RESULTS_TABLE

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="security")

DIGEST = "d" * 64

WRITE_RESULT = f"""
    insert into {TOOL_RESULTS_TABLE}
        (project_id, source_checksum, tool, tool_version, parameters_digest, result)
    values (%s, %s, 'face', '2+test', %s, %s)
"""

WRITE_RESULT_IGNORING_DUPLICATES = (
    WRITE_RESULT + " on conflict (project_id, tool, tool_version, parameters_digest) do nothing"
)

RESULTS_FOR = f"select count(*) from {TOOL_RESULTS_TABLE} where project_id = %s"


def _cache_as_postgres(conn: psycopg.Connection) -> None:
    """One cached result under artist A's project, written with RLS bypassed."""
    conn.execute(WRITE_RESULT, (PROJECT_A, CHECKSUM_A, DIGEST, Jsonb({"face": None})))


# ---------------------------------------------------------------------------------------------
# Controls
# ---------------------------------------------------------------------------------------------


def test_authenticated_holds_select_and_insert(db: psycopg.Connection) -> None:
    """The control for every isolation test: a denial below has to be RLS, not a missing grant."""
    held = {
        verb: db.execute(
            "select has_table_privilege(%s, %s, %s)", (AUTHENTICATED, TOOL_RESULTS_TABLE, verb)
        ).fetchone()[0]
        for verb in ("SELECT", "INSERT")
    }

    assert all(held.values()), f"{AUTHENTICATED} is missing grants on {TOOL_RESULTS_TABLE}: {held}"


def test_the_cached_row_exists_when_no_policy_is_deciding(two_artists: psycopg.Connection) -> None:
    _cache_as_postgres(two_artists)

    assert count(two_artists, RESULTS_FOR, (PROJECT_A,)) == 1


# ---------------------------------------------------------------------------------------------
# Privileges
# ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize("verb", ["SELECT", "INSERT", "UPDATE", "DELETE"])
def test_anon_holds_nothing(db: psycopg.Connection, verb: str) -> None:
    """The anon key is a published value."""
    held = db.execute(
        "select has_table_privilege(%s, %s, %s)", (ANON, TOOL_RESULTS_TABLE, verb)
    ).fetchone()[0]

    assert held is False


@pytest.mark.parametrize("verb", ["UPDATE", "DELETE"])
def test_authenticated_cannot_change_or_remove_a_result(db: psycopg.Connection, verb: str) -> None:
    """A result never changes, and it leaves only with its project.

    Supabase's default privileges would have granted both; the migration's revoke is what took
    them away, so this is the assertion that catches a revoke being dropped.
    """
    held = db.execute(
        "select has_table_privilege(%s, %s, %s)", (AUTHENTICATED, TOOL_RESULTS_TABLE, verb)
    ).fetchone()[0]

    assert held is False


# ---------------------------------------------------------------------------------------------
# Isolation
# ---------------------------------------------------------------------------------------------


def test_an_artist_can_cache_a_result_for_their_own_original(
    two_artists: psycopg.Connection,
) -> None:
    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn:
        conn.execute(WRITE_RESULT, (PROJECT_A, CHECKSUM_A, DIGEST, Jsonb({"face": None})))
        visible = count(conn, RESULTS_FOR, (PROJECT_A,))

    assert visible == 1


def test_an_artist_cannot_see_another_artists_results(two_artists: psycopg.Connection) -> None:
    _cache_as_postgres(two_artists)

    with acting_as(two_artists, AUTHENTICATED, ARTIST_B) as conn:
        visible = count(conn, RESULTS_FOR, (PROJECT_A,))

    assert visible == 0


def test_an_artist_cannot_cache_a_result_under_another_artists_project(
    two_artists: psycopg.Connection,
) -> None:
    with acting_as(two_artists, AUTHENTICATED, ARTIST_B) as conn, refused(conn):
        conn.execute(WRITE_RESULT, (PROJECT_A, CHECKSUM_A, DIGEST, Jsonb({"face": None})))


def test_a_result_must_cite_its_projects_own_original(two_artists: psycopg.Connection) -> None:
    """FR-105. A row under project A that claims to describe other bytes is refused.

    Without this, every later cache hit would hand the artist a measurement of the wrong
    photograph as a measurement of theirs.
    """
    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn, refused(conn):
        conn.execute(WRITE_RESULT, (PROJECT_A, CHECKSUM_B, DIGEST, Jsonb({"face": None})))


def test_a_project_with_no_original_can_cache_nothing(two_artists: psycopg.Connection) -> None:
    """Project B has no upload yet, so there is no checksum a result could honestly cite."""
    with acting_as(two_artists, AUTHENTICATED, ARTIST_B) as conn, refused(conn):
        conn.execute(WRITE_RESULT, (PROJECT_B, CHECKSUM_B, DIGEST, Jsonb({"face": None})))


# ---------------------------------------------------------------------------------------------
# The cache's own behaviour
# ---------------------------------------------------------------------------------------------


def test_a_repeated_recipe_is_ignored_rather_than_refused(two_artists: psycopg.Connection) -> None:
    """What the agent's `resolution=ignore-duplicates` becomes, run as the artist.

    Two runs racing on one recipe must both succeed. `on conflict do nothing` needs no UPDATE
    privilege, which is why a select-and-insert grant is enough for it.
    """
    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn:
        for result in ({"face": None}, {"face": "the loser"}):
            conn.execute(
                WRITE_RESULT_IGNORING_DUPLICATES, (PROJECT_A, CHECKSUM_A, DIGEST, Jsonb(result))
            )
        kept = conn.execute(
            f"select result from {TOOL_RESULTS_TABLE} where project_id = %s", (PROJECT_A,)
        ).fetchall()

    assert kept == [({"face": None},)]


def test_a_result_is_immutable_even_with_rls_bypassed(two_artists: psycopg.Connection) -> None:
    """The trigger covers `postgres` and `service_role`, which no grant or policy restrains."""
    _cache_as_postgres(two_artists)

    with refused(two_artists, psycopg.errors.RestrictViolation):
        two_artists.execute(
            f"update {TOOL_RESULTS_TABLE} set result = %s where project_id = %s",
            (Jsonb({"face": "rewritten"}), PROJECT_A),
        )


def test_deleting_the_project_deletes_its_results(two_artists: psycopg.Connection) -> None:
    """FR-806, through ADR 0003's unchanged path: the artist deletes the project, nothing else.

    The artist holds no DELETE on `tool_results`. The cascade is performed internally and is not
    subject to this table's policies — asserted here rather than assumed, because a cascade that
    RLS silently blocked would leave cached measurements of a deleted photograph behind.
    """
    _cache_as_postgres(two_artists)
    assert count(two_artists, RESULTS_FOR, (PROJECT_A,)) == 1

    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn:
        conn.execute(f"delete from {PROJECTS_TABLE} where id = %s", (PROJECT_A,))

    assert count(two_artists, RESULTS_FOR, (PROJECT_A,)) == 0
