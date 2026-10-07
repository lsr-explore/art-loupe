"""Reporting each node's start and finish to the run log.

The studio follows a run over SSE, and what it shows while the run works is this: which node is
running, and which have finished. `reported` wraps each node at registration, beside
`instrumented`, so a node that reports nothing would stand out in `graph.py` the same way an
unmetered one does.

A failed report never fails the run. Losing a progress line costs the artist a step on the
screen. Failing the run because of it would cost them the analysis, which is the trade
`artloupe.agent.runtime._flush` makes for the ledger, for the same reason.
"""

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from artloupe.agent.resources import active_run_resources
from artloupe.persistence import RunEventKind

logger = logging.getLogger(__name__)


async def report(kind: RunEventKind, node: str) -> None:
    """Report one node event, if the active run has somewhere to report it."""
    resources = active_run_resources()
    if resources is None or resources.progress is None:
        return
    try:
        await resources.progress(kind, {"node": node})
    except Exception:
        logger.exception("failed to report run progress", extra={"node": node, "kind": kind})


def reported(name: str, node: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
    """Wrap an async node so its start and finish reach the run log.

    A node that raises reports no finish. The run's own `failed` event says what stopped it.
    """

    async def run(*args: Any, **kwargs: Any) -> Any:
        await report("node_started", name)
        update = await node(*args, **kwargs)
        await report("node_finished", name)
        return update

    run.__name__ = getattr(node, "__name__", name)
    run.__doc__ = node.__doc__
    return run
