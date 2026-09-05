"""A two-node interrupt/resume graph, runnable as a standalone process.

This is a **spike**: it exists to prove the mechanism, not to ship behaviour. It is executed
by path from `test_interrupt_resume.py` as a separate `python` process, which is the whole
point — `start` and `resume` must be able to run in different processes with nothing shared
between them but the database.

The graph deliberately mirrors the shape the real geometry correction will need:

    propose  ->  await_correction  ->  apply

`propose` has a **side effect** (it appends to `side_effects`). `await_correction` does
nothing except `interrupt()`. That separation is the lesson this spike encodes: on resume,
LangGraph re-runs the whole node containing the interrupt from the top, so anything that node
did before interrupting happens twice. Keeping `interrupt()` alone in its own node is what
stops a resumed run from double-charging the budget ledger (NFR-04).

Usage, both forms exercised by the test:

    python spike_runner.py start  <thread-id>
    python spike_runner.py resume <thread-id> <corrected-value>
"""

import asyncio
import json
import operator
import sys
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from artloupe.persistence import get_async_checkpointer


class SpikeState(TypedDict):
    thread: str
    # Accumulates, so the test can prove `propose` ran exactly once across a restart.
    side_effects: Annotated[list[str], operator.add]
    corrected: str


def propose(state: SpikeState) -> dict[str, list[str]]:
    """Stands in for a geometry tool returning a low-confidence candidate.

    The append is the observable side effect. If this node also carried the interrupt, this
    list would have two entries after a resume instead of one.
    """
    return {"side_effects": [f"proposed:{state['thread']}"]}


def await_correction(_state: SpikeState) -> dict[str, str]:
    """Nothing but the interrupt.

    No I/O, no metering, no state mutation before the call. Re-running this node from the top
    on resume is therefore free, which is precisely why it is shaped this way.
    """
    corrected = interrupt({"reason": "confidence below threshold", "field": "vanishing_point"})
    return {"corrected": corrected}


def apply(state: SpikeState) -> dict[str, list[str]]:
    return {"side_effects": [f"applied:{state['corrected']}"]}


def build_spike_graph(checkpointer):
    builder = StateGraph(SpikeState)
    builder.add_node("propose", propose)
    builder.add_node("await_correction", await_correction)
    builder.add_node("apply", apply)
    builder.add_edge(START, "propose")
    builder.add_edge("propose", "await_correction")
    builder.add_edge("await_correction", "apply")
    builder.add_edge("apply", END)
    return builder.compile(checkpointer=checkpointer)


async def _run(command: str, thread: str, value: str | None) -> dict:
    checkpointer = await get_async_checkpointer()
    graph = build_spike_graph(checkpointer)
    config = {"configurable": {"thread_id": thread}}

    if command == "start":
        result = await graph.ainvoke(
            {"thread": thread, "side_effects": [], "corrected": ""}, config=config
        )
    else:
        result = await graph.ainvoke(Command(resume=value), config=config)

    snapshot = await graph.aget_state(config)
    return {
        "side_effects": result.get("side_effects", []),
        "corrected": result.get("corrected", ""),
        # Non-empty while the run is paused; empty once it has run to completion.
        "pending": list(snapshot.next),
    }


def main() -> None:
    command = sys.argv[1]
    thread = sys.argv[2]
    value = sys.argv[3] if len(sys.argv) > 3 else None
    # stdout is the process boundary the test reads across, so it carries only this JSON.
    print(json.dumps(asyncio.run(_run(command, thread, value))))


if __name__ == "__main__":
    main()
