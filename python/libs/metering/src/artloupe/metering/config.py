"""Runtime configuration for metering and the run guards.

Read from the environment at first use, never at import, so the module can be imported in a
build step or a test collection that has no database — the same rule `artloupe.auth.config`
and `artloupe.persistence.config` follow.

Every guard value is configuration rather than a constant. Two reasons, and only the second
is obvious: a demo needs to be able to tighten a ceiling to *show* the hard stop firing, and
the honest defaults are not knowable yet — `docs/design/agents.md` §9 lists per-agent model
assignment as open, and a token ceiling means something different once that is settled.
Defaults here are deliberately generous enough not to fire in normal operation and small
enough to still be a real stop.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

MeteringMode = Literal["memory", "postgres"]


class MeteringSettings(BaseSettings):
    """Environment-backed settings for the ledger and the guards."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    artloupe_metering: MeteringMode = Field(
        default="memory",
        description=(
            "'memory' keeps the ledger in-process, which is correct for unit tests and wrong "
            "for anything operations has to read afterwards. 'postgres' writes to "
            "`public.run_node_metrics`, which is what FR-905 renders."
        ),
    )

    database_url: str = Field(
        default="postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        description=(
            "Local Supabase by default, matching `pnpm supabase status`. Shared with "
            "`artloupe.persistence` — same variable, same database, different tables."
        ),
    )

    artloupe_run_recursion_limit: int = Field(
        default=25,
        gt=0,
        description=(
            "Maximum supersteps in one graph run. 25 is LangGraph's own default, kept rather "
            "than invented so the number is recognisable; it is passed explicitly so the cap "
            "is a stated decision rather than a library default nobody chose."
        ),
    )

    artloupe_run_node_visit_limit: int = Field(
        default=10,
        gt=0,
        description=(
            "Maximum times one node may run in a single graph run. Redundant with the "
            "recursion limit for a straight ping-pong, and not redundant for diagnosis: this "
            "one fires earlier and names the node that is looping."
        ),
    )

    artloupe_run_wall_clock_seconds: float = Field(
        default=120.0,
        gt=0,
        description=(
            "Deadline for one graph run. NFR-03 budgets p95 45-60s cold for a full plan "
            "graph, so this is roughly double the slow case: headroom for a cold run, and a "
            "stop for a hung one."
        ),
    )

    artloupe_plan_token_ceiling: int = Field(
        default=250_000,
        gt=0,
        description=(
            "The NFR-04 per-project plan budget, in tokens, counting input and output "
            "together. Covers plan generation only — chat credits (NFR-11) are a separate "
            "meter and neither can stop the other."
        ),
    )

    @property
    def persistence_enabled(self) -> bool:
        """True when the ledger must outlive the process that wrote it."""
        return self.artloupe_metering == "postgres"


@lru_cache(maxsize=1)
def get_settings() -> MeteringSettings:
    """Process-wide settings, resolved once.

    Cached rather than module-level so import stays side-effect free; tests clear it with
    `get_settings.cache_clear()`.
    """
    return MeteringSettings()
