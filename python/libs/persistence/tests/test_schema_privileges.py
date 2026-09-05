"""The checkpoint schema is unreachable by the roles PostgREST authenticates as.

`test_interrupt_resume.py` proves the tables land in `langgraph` rather than an API-exposed
schema. That is placement. This file asserts the consequence that placement is *for*: a
caller holding the anon key -- a published value, not a secret -- can read nothing there.

Why this is a separate file and needs a real Supabase database: `anon` and `authenticated` are
Supabase-provisioned roles, absent from stock Postgres. Run against a plain `postgres` image
these assertions pass without testing anything, because the roles they name do not exist. The
`public` control below is what keeps that from happening silently -- it asserts the grants
this schema is being protected *from* are live in this database.

One thing measured here and worth not re-deriving: the migration's `revoke` statements are
**not** what produces the result. Supabase's default-privilege grants to `anon` are
schema-scoped -- `public`, `graphql`, `graphql_public`, `storage`, `supabase_functions` -- with
no wildcard reaching a new schema, so revoking in `langgraph` revokes something never granted
and `pg_default_acl` records nothing. A schema created with no revokes at all measures
identically. The protection is Supabase granting nothing in a new schema by default; the
revokes are a cheap guard against that changing. So this file asserts the outcome, which is
falsifiable, rather than the revokes, which are not.
"""

import os

import psycopg
import pytest

from artloupe.persistence import CHECKPOINT_SCHEMA

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="security")

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
REQUIRE_POSTGRES = os.environ.get("ARTLOUPE_REQUIRE_POSTGRES") == "1"

# The roles PostgREST assumes for an unauthenticated and a logged-in caller. Anything
# reachable by these is reachable by anyone holding the anon key.
API_ROLES = ("anon", "authenticated")


def _connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, connect_timeout=3)


@pytest.fixture(scope="module", autouse=True)
def supabase_database_required() -> None:
    """Skip on a bare Postgres locally; fail on one in CI.

    A developer without the Supabase stack running should not see a red suite. CI sets
    `ARTLOUPE_REQUIRE_POSTGRES`, where a database missing these roles means the job booted the
    wrong image -- and skipping would hide exactly the regression this file exists to catch.
    """
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


def test_the_grants_this_schema_is_protected_from_are_live_here() -> None:
    """The control. Without it every other assertion in this file could be vacuous.

    A table in `public` is readable by `anon` because Supabase grants default privileges
    there. If this stops holding, the database under test is not one where checkpoints in
    `public` would leak -- so the assertions below stop meaning what they claim.
    """
    with _connect() as conn:
        conn.execute("create table if not exists public.privilege_control_probe (id int)")
        try:
            readable = {
                role: conn.execute(
                    "select has_table_privilege(%s, 'public.privilege_control_probe', 'SELECT')",
                    (role,),
                ).fetchone()[0]
                for role in API_ROLES
            }
        finally:
            conn.execute("drop table if exists public.privilege_control_probe")
        conn.commit()

    assert all(readable.values()), (
        f"expected {'/'.join(API_ROLES)} to read a table in `public`, got {readable}. "
        "Without that, this file's other assertions prove nothing."
    )


def test_api_roles_cannot_use_the_checkpoint_schema() -> None:
    with _connect() as conn:
        usable = {
            role: conn.execute(
                "select has_schema_privilege(%s, %s, 'USAGE')", (role, CHECKPOINT_SCHEMA)
            ).fetchone()[0]
            for role in API_ROLES
        }

    assert not any(usable.values()), (
        f"{'/'.join(API_ROLES)} hold USAGE on `{CHECKPOINT_SCHEMA}`: {usable}. "
        "Checkpoints carry live project state and references to the artist's upload."
    )


def test_api_roles_cannot_read_any_checkpoint_table() -> None:
    """Every table actually present, not a fixture -- the saver owns their names and count."""
    with _connect() as conn:
        tables = [
            row[0]
            for row in conn.execute(
                "select tablename from pg_tables where schemaname = %s", (CHECKPOINT_SCHEMA,)
            ).fetchall()
        ]
        leaked = {
            f"{table}:{role}": True
            for table in tables
            for role in API_ROLES
            if conn.execute(
                "select has_table_privilege(%s, %s, 'SELECT')",
                (role, f"{CHECKPOINT_SCHEMA}.{table}"),
            ).fetchone()[0]
        }

    assert tables, (
        f"no tables in `{CHECKPOINT_SCHEMA}` -- run the interrupt/resume suite first, or the "
        "saver never ran and this assertion is vacuous."
    )
    assert not leaked, f"checkpoint tables readable through the API roles: {sorted(leaked)}"


def test_the_checkpoint_schema_is_absent_from_the_postgrest_surface() -> None:
    """`config.toml` decides this, but the assertion belongs next to its consequence.

    Adding `langgraph` to `schemas` there is a one-line edit that would route PostgREST at the
    checkpoint tables. Reading the file keeps that edit from passing review unnoticed.
    """
    from pathlib import Path

    config = Path(__file__).resolve().parents[4] / "supabase" / "config.toml"
    assert config.is_file(), f"expected supabase/config.toml at {config}"

    exposed = next(
        line for line in config.read_text().splitlines() if line.strip().startswith("schemas =")
    )
    assert CHECKPOINT_SCHEMA not in exposed, (
        f"`{CHECKPOINT_SCHEMA}` is exposed through PostgREST by config.toml: {exposed.strip()}"
    )
