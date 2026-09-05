"""Runtime configuration for checkpointing.

Read from the environment at first use, never at import, so the module can be imported in a
build step or a test collection that has no database — the same rule
`artloupe.auth.config` follows.

Third-party variables keep their vendor names (`DATABASE_URL`); Art Loupe's own settings carry
the `ARTLOUPE_` prefix, matching `python/.env.example`.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PersistenceMode = Literal["memory", "postgres"]

# Where LangGraph's checkpoint tables live.
#
# Deliberately NOT `public`. `supabase/config.toml` exposes `["public", "graphql_public"]`
# through PostgREST, so a table created in `public` without RLS is readable by anyone holding
# the anon key — which is a public value. Checkpoints carry project state and image
# references, so they go in a schema the API never exposes.
#
# The saver has no schema parameter; isolation is achieved by setting `search_path` on the
# connection. See `checkpointer.connection_kwargs`.
CHECKPOINT_SCHEMA = "langgraph"


class PersistenceSettings(BaseSettings):
    """Environment-backed settings for the checkpointer."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    artloupe_persistence: PersistenceMode = Field(
        default="memory",
        description=(
            "'memory' keeps checkpoints in-process, which is correct for unit tests and "
            "wrong for anything that must survive a restart. 'postgres' is required for a "
            "real interrupt: the artist may resume minutes later, in a different process."
        ),
    )

    database_url: str = Field(
        default="postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        description=(
            "Local Supabase by default, matching `pnpm supabase status`. This is a direct "
            "Postgres connection, not the PostgREST API, and it bypasses RLS — which is why "
            "the checkpoint schema is not API-exposed rather than relying on row policies."
        ),
    )

    artloupe_checkpoint_pool_max: int = Field(
        default=10,
        description="Upper bound on pooled connections. One pool per process, not per graph.",
    )

    @property
    def persistence_enabled(self) -> bool:
        """True when checkpoints must outlive the process that wrote them."""
        return self.artloupe_persistence == "postgres"


@lru_cache(maxsize=1)
def get_settings() -> PersistenceSettings:
    """Process-wide settings, resolved once.

    Cached rather than module-level so import stays side-effect free; tests clear it with
    `get_settings.cache_clear()`.
    """
    return PersistenceSettings()
