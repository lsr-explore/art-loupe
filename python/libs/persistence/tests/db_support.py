"""Helpers for the suites that assert against a real Supabase database.

Not `conftest.py`: pytest imports every `conftest.py` in the tree, and this workspace already
has one at `python/conftest.py`, so `from conftest import ...` is ambiguous in a way that
depends on collection order. The fixtures stay in `conftest.py`, where pytest finds them
without an import; the constants and helpers live here, where a test can name the module it is
importing from.

Two rules shape everything below.

**Every write is rolled back.** The local Postgres is shared between concurrent worktrees, so
each test runs inside one transaction that is discarded at teardown, and an expected failure is
wrapped in a savepoint so the connection survives it.

**Skip locally, fail in CI.** A developer without `pnpm supabase start` running should not see a
red suite. CI sets `ARTLOUPE_REQUIRE_POSTGRES=1`, where an unreachable or non-Supabase database
means the job booted the wrong image -- and skipping would hide exactly the regression these
files exist to catch.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
import pytest

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
REQUIRE_POSTGRES = os.environ.get("ARTLOUPE_REQUIRE_POSTGRES") == "1"

# The roles PostgREST assumes for an unauthenticated and a signed-in caller.
ANON = "anon"
AUTHENTICATED = "authenticated"
API_ROLES = (ANON, AUTHENTICATED)

# Two artists who are not each other. Well-formed version 4 UUIDs, because the columns are
# `uuid` and a malformed literal would fail for a reason unrelated to the policy under test.
ARTIST_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
ARTIST_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"
PROJECT_A = "aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa"
PROJECT_B = "bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb"

CHECKSUM_A = "a" * 64
CHECKSUM_B = "b" * 64


def storage_key(owner_id: str, project_id: str, checksum: str) -> str:
    """The object key format the storage policies and the check constraint both depend on.

    Mirrors `buildReferenceImageKey` in `apps/studio/src/lib/storage/reference-images.ts`. The
    arbiter of the format is neither copy but the `source_images_key_matches_project_and_checksum`
    constraint, which the schema suite asserts against directly.
    """
    return f"{owner_id}/{project_id}/{checksum}"


def connect() -> psycopg.Connection:
    """Connect as `postgres`, which holds BYPASSRLS.

    That is deliberate and is what makes the controls possible: a test can establish that rows
    exist and are readable when no policy is deciding, then switch to `authenticated` and show
    the policy taking them away.
    """
    return psycopg.connect(DATABASE_URL, connect_timeout=5)


def require_supabase() -> None:
    """Skip on a bare Postgres locally; fail on one in CI."""
    try:
        with psycopg.connect(DATABASE_URL, connect_timeout=3) as conn:
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
            "That is a stock Postgres, not the Supabase stack, and every privilege assertion "
            "would answer about roles that do not exist."
        )
    pytest.skip("not a Supabase database -- run `pnpm supabase start`, not a bare postgres")


@contextmanager
def acting_as(
    conn: psycopg.Connection, role: str, user_id: str | None = None
) -> Iterator[psycopg.Connection]:
    """Run the enclosed statements as a PostgREST role, with a JWT `sub` claim if given.

    This reproduces on a direct connection what PostgREST does per request: switch to the role
    the token names, and publish the token's claims as `request.jwt.claims`, which is where
    `auth.uid()` reads from. Both settings are transaction-scoped, so leaving the block restores
    the previous caller and the outer rollback erases the rest.

    Wrap an expected failure in `refused` *inside* this block, never outside it: restoring the
    role needs a connection that is not in a failed transaction.
    """
    if role not in API_ROLES:
        raise ValueError(f"acting_as expects a PostgREST role, got {role!r}")

    # Interpolated because `set role` takes an identifier rather than a parameter. The value is
    # checked against a fixed tuple above, so nothing caller-supplied reaches the statement.
    conn.execute(f"set local role {role}")
    if user_id is not None:
        conn.execute(
            "select set_config('request.jwt.claims', %s, true)",
            (json.dumps({"sub": user_id, "role": role}),),
        )
    try:
        yield conn
    finally:
        conn.execute("reset role")
        conn.execute("select set_config('request.jwt.claims', '', true)")


@contextmanager
def refused(
    conn: psycopg.Connection, error: type[psycopg.Error] = psycopg.errors.InsufficientPrivilege
) -> Iterator[None]:
    """Expect the enclosed statement to be refused, and keep the connection usable.

    The savepoint is the working part. Without it the first refusal poisons the transaction and
    every later statement -- including the role reset and the fixture teardown -- fails with
    `InFailedSqlTransaction`, which reads like a cascade of unrelated breakage.

    Row-level security refusals arrive as `InsufficientPrivilege` (SQLSTATE 42501), the same
    class as a missing GRANT. That ambiguity is exactly why each test here is paired with a
    control showing the grant is present.
    """
    with pytest.raises(error), conn.transaction():
        yield


def count(conn: psycopg.Connection, statement: str, params: tuple[object, ...] = ()) -> int:
    """First column of the first row, as an int. Every use of it here is a `count(*)`."""
    return int(conn.execute(statement, params).fetchone()[0])
