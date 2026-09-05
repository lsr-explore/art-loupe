"""Executing a graph under its guards, with every node measured.

This is the one place a run is started. That is the point of the module: a recursion limit
applied at some call sites and not others is not a limit, and the way a ceiling stops being
enforced is that someone calls `graph.ainvoke` directly. Everything that runs the studio graph
goes through `execute_run`, and the guards come with it.

`artloupe-metering` deliberately knows nothing about LangGraph — it counts runs, not
topologies — so the translation lives here:

- `RunGuards.recursion_limit` becomes LangGraph's own `recursion_limit`, and its
  `GraphRecursionError` is re-raised as `RecursionLimitExceeded` so a caller has one exception
  family rather than two names for the same event.
- `RunGuards.wall_clock_seconds` becomes an `asyncio.timeout` around the whole invocation.
  This is a **backstop**, not the mechanism: the recorder fails cleanly at the next node
  boundary, which leaves a checkpoint that can be reasoned about, and the timeout only catches
  the case that never reaches a boundary — one node that hangs.

The ledger is flushed in a `finally`, and that is deliberate. The runs operations most needs
to see are the ones that stopped: a budget exhaustion whose ledger was discarded on the way
out is invisible in exactly the situation the ledger exists for.
"""

import asyncio
import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from langgraph.errors import GraphRecursionError

from artloupe.metering import (
    NodeMetric,
    RecursionLimitExceeded,
    RunGuards,
    RunRecorder,
    WallClockExceeded,
    get_metrics_sink,
    use_recorder,
)
from artloupe.schemas import BudgetLedger

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RunOutcome:
    """A finished run: what it produced, and what it spent producing it."""

    state: dict[str, Any]
    ledger: BudgetLedger
    metrics: list[NodeMetric]
    cost_usd: Decimal


async def execute_run(
    graph: Any,
    initial_state: dict[str, Any],
    *,
    run_id: str,
    owner: str,
    guards: RunGuards | None = None,
    sink: Any = None,
    config: dict[str, Any] | None = None,
) -> RunOutcome:
    """Run `graph` to completion under `guards`, recording every node.

    Raises `GuardTripped` (one of its subclasses) when a ceiling stops the run. The ledger is
    written either way.
    """
    resolved_guards = guards or RunGuards.from_settings()
    resolved_sink = sink if sink is not None else get_metrics_sink()
    recorder = RunRecorder(run_id=run_id, owner=owner, guards=resolved_guards)

    invocation: dict[str, Any] = {"recursion_limit": resolved_guards.recursion_limit}
    if config:
        invocation.update(config)

    try:
        with use_recorder(recorder):
            async with asyncio.timeout(resolved_guards.wall_clock_seconds):
                state = await graph.ainvoke(initial_state, config=invocation)
    except GraphRecursionError as error:
        raise RecursionLimitExceeded(
            f"run {run_id} exceeded its limit of {resolved_guards.recursion_limit} supersteps"
        ) from error
    except TimeoutError as error:
        # Reached only when a single node never returns; the recorder's boundary check catches
        # every case where the graph is still making progress.
        raise WallClockExceeded(
            f"run {run_id} exceeded its {resolved_guards.wall_clock_seconds:g}s deadline"
        ) from error
    finally:
        await _flush(resolved_sink, recorder)

    return RunOutcome(
        state=state,
        ledger=recorder.ledger,
        metrics=list(recorder.metrics),
        cost_usd=recorder.cost_usd,
    )


async def _flush(sink: Any, recorder: RunRecorder) -> None:
    """Persist the ledger, and never let failing to do so fail the run.

    Losing an operations row is bad. Discarding an artist's completed analysis because a
    metrics insert timed out is worse, and it is the trade this `except` makes on purpose.
    """
    try:
        await sink.flush(recorder.metrics)
    except Exception:
        logger.exception("failed to flush the run ledger", extra={"run_id": recorder.run_id})
