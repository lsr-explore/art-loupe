"""The caps on a run, and the exceptions that fire when one is reached.

A guard is not error handling. Each of these represents a run that was *stopped on purpose*,
and the distinction matters downstream: `docs/design/agents.md` §8 renders `BUDGET_STOPPED`
as its own terminal state, separate from `FAILED`, because a budget working as designed is
not a fault. They share a base class so a caller can catch the family, and stay distinct so
the caller can map each to the right outcome.

Why four caps rather than one:

- `recursion_limit` bounds the graph as a whole and is enforced by LangGraph itself.
- `node_visit_limit` bounds a single node and is enforced here. It overlaps the first for a
  simple two-node loop, and does not overlap it at all for diagnosis — it names the node.
- `wall_clock_seconds` bounds elapsed time, which neither of the above does: one slow
  external call can sit inside a single superstep indefinitely.
- `token_ceiling` bounds spend (NFR-04), which none of the above does: a short, cheap-looking
  graph can spend a fortune in three nodes if each one carries a large context.
"""

from dataclasses import dataclass

from artloupe.metering.config import MeteringSettings, get_settings


class GuardTripped(Exception):
    """A run was stopped by one of its own ceilings.

    Carries `reason` because every stop has to be explainable — `BudgetLedger` refuses to be
    marked stopped without one, and an operations row that says only "stopped" is
    unreviewable.
    """

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class BudgetExceeded(GuardTripped):
    """The NFR-04 plan-budget token ceiling was reached. Terminal state `BUDGET_STOPPED`."""


class WallClockExceeded(GuardTripped):
    """The run passed its deadline."""


class NodeVisitLimitExceeded(GuardTripped):
    """One node ran more times than the run allows — a loop that is not converging."""


class RecursionLimitExceeded(GuardTripped):
    """The graph took more supersteps than the run allows.

    Raised in place of LangGraph's own `GraphRecursionError` so callers have one exception
    family to handle rather than two that mean the same thing.
    """


@dataclass(frozen=True)
class RunGuards:
    """Every ceiling one run is subject to.

    Frozen: guards are decided when a run starts and must not drift while it executes. A run
    that could raise its own ceiling mid-flight would not have one.
    """

    recursion_limit: int
    node_visit_limit: int
    wall_clock_seconds: float
    token_ceiling: int

    @classmethod
    def from_settings(cls, settings: MeteringSettings | None = None) -> "RunGuards":
        """Build the configured guards, reading the environment unless one is supplied."""
        resolved = settings or get_settings()
        return cls(
            recursion_limit=resolved.artloupe_run_recursion_limit,
            node_visit_limit=resolved.artloupe_run_node_visit_limit,
            wall_clock_seconds=resolved.artloupe_run_wall_clock_seconds,
            token_ceiling=resolved.artloupe_plan_token_ceiling,
        )
