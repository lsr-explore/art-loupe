"""Checkpointer construction, and the schema isolation that keeps checkpoints off the API.

Tagged `security` for the schema cases rather than `functionality`: a checkpoint table in
`public` is readable by anyone holding the anon key, which is a published value. That is a
disclosure bug, not a broken feature.
"""

import pytest

from artloupe.persistence import (
    CHECKPOINT_SCHEMA,
    PersistenceSettings,
    connection_kwargs,
    get_async_checkpointer,
    get_settings,
    reset_checkpointer,
)

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")


@pytest.fixture(autouse=True)
def clean_settings() -> None:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_defaults_to_memory_so_tests_stay_hermetic() -> None:
    """The default must never be Postgres — a unit test should not need a database."""
    saver = await get_async_checkpointer()
    assert type(saver).__name__ == "InMemorySaver"
    await reset_checkpointer()


def test_memory_mode_is_not_persistence() -> None:
    assert PersistenceSettings(artloupe_persistence="memory").persistence_enabled is False
    assert PersistenceSettings(artloupe_persistence="postgres").persistence_enabled is True


@pytest.mark.trace(flow="platform.agent-runtime", category="security")
def test_connection_puts_checkpoints_in_their_own_schema() -> None:
    """`AsyncPostgresSaver` has no schema parameter; `search_path` is the only lever.

    If this regresses, the saver silently creates its tables in `public` — which
    `supabase/config.toml` exposes through PostgREST — and nothing else in the suite would
    notice, because the graph would keep working perfectly.
    """
    options = connection_kwargs()["options"]
    assert f"-csearch_path={CHECKPOINT_SCHEMA}" in options
    assert not options.startswith("-csearch_path=public")


@pytest.mark.trace(flow="platform.agent-runtime", category="security")
def test_checkpoint_schema_is_not_one_postgrest_exposes() -> None:
    """Pins the reason the schema name matters, not just the name itself."""
    assert CHECKPOINT_SCHEMA not in {"public", "graphql_public"}


def test_setup_ddl_requires_autocommit_and_no_prepared_statements() -> None:
    """Both are correctness requirements, not style.

    `.setup()` issues DDL that must not sit inside an open transaction, and pooled
    connections reject prepared statements. A future tidy-up that drops either turns into an
    intermittent failure at startup rather than an obvious one.
    """
    kwargs = connection_kwargs()
    assert kwargs["autocommit"] is True
    assert kwargs["prepare_threshold"] is None
