"""Fixtures for the suites that assert against a real Supabase database.

The constants and helpers these fixtures use live in `db_support.py`, which explains why they
are not in this file. `test_schema_privileges.py` states the same skip-locally/fail-in-CI rule
in its own words and predates all of this; it is left as it is rather than rewritten underneath
a pull request that already went through review.
"""

from __future__ import annotations

from collections.abc import Iterator

import psycopg
import pytest
from db_support import (
    ARTIST_A,
    ARTIST_B,
    CHECKSUM_A,
    PROJECT_A,
    PROJECT_B,
    connect,
    require_supabase,
    storage_key,
)
from psycopg.types.json import Jsonb


@pytest.fixture(scope="session")
def supabase_database_available() -> None:
    """Requested by `db` rather than autouse.

    The checkpointer tests in this same directory are hermetic and must keep running when no
    database is up.
    """
    require_supabase()


@pytest.fixture
def db(supabase_database_available: None) -> Iterator[psycopg.Connection]:
    """A connection whose entire transaction is discarded afterwards.

    The local Postgres is shared with other worktrees, so nothing a test writes is allowed to
    outlive it.
    """
    conn = connect()
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


@pytest.fixture
def two_artists(db: psycopg.Connection) -> psycopg.Connection:
    """Two artists, a project each, and one uploaded original belonging to artist A.

    Written with RLS bypassed, so the rows demonstrably exist before any policy is asked about
    them. That is what makes an empty result under `authenticated` mean something.
    """
    db.execute(
        "insert into auth.users (id, email) values (%s, %s), (%s, %s)",
        (ARTIST_A, "artist-a@artloupe.test", ARTIST_B, "artist-b@artloupe.test"),
    )
    db.execute(
        "insert into public.projects (id, owner_id, intent) values (%s, %s, %s), (%s, %s, %s)",
        (
            PROJECT_A,
            ARTIST_A,
            Jsonb({"medium": "oil", "time_budget_minutes": 90}),
            PROJECT_B,
            ARTIST_B,
            Jsonb({"medium": "graphite", "time_budget_minutes": 45}),
        ),
    )
    db.execute(
        """
        insert into public.source_images
            (project_id, checksum, storage_key, mime_type, width_px, height_px, byte_size)
        values (%s, %s, %s, 'image/jpeg', 1600, 1200, 240000)
        """,
        (PROJECT_A, CHECKSUM_A, storage_key(ARTIST_A, PROJECT_A, CHECKSUM_A)),
    )
    return db
