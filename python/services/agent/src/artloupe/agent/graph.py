"""The studio graph.

One node, for now. This exists so the FastAPI surface, the auth guard, and a compiled
LangGraph are wired together and proven end to end *before* any of them carries real work —
the failure mode this avoids is discovering a transport or lifecycle problem while also
debugging the Studio Director's routing.

The shape that matters and will not change:

- `build_graph(checkpointer=None)` takes its checkpointer by injection rather than building
  one. PR 3 introduces the Postgres saver, and it has to be a process-wide singleton owned
  outside the graph — a graph that constructed its own would open a connection pool per call.
  The sibling repo `veloce-trace` settled on this same signature for the same reason.
- Nodes return *partial* state. `RunState.node_trail` accumulates via its reducer; returning
  the whole state from a node would fight that.
- Every node is registered through `instrumented(...)`. Wrapping at registration rather than
  in the node bodies is what makes "unmetered node" a thing you can see in a diff: an
  `add_node` call without the wrapper stands out, where a missing decorator inside a function
  does not. A node that is not wrapped costs money nobody can attribute.

The guards themselves are not applied here. `recursion_limit` and the wall-clock deadline
belong to the *invocation*, not the topology, so they live in `artloupe.agent.runtime` —
which is the only thing that should ever call `ainvoke` on this graph.
"""

from langgraph.graph import END, START, StateGraph

from artloupe.agent.state import RunState
from artloupe.metering import instrumented


def seed(state: RunState) -> dict[str, list[str]]:
    """Record that the graph ran.

    The placeholder the Studio Director replaces in PR 12. It reads `run_id` rather than
    ignoring state entirely, so the wiring proven here is the wiring the real node needs.
    """
    return {"node_trail": [f"seed:{state['run_id']}"]}


def build_graph(checkpointer=None):
    """Compile the studio graph.

    `checkpointer` is `None` in tests and for stateless calls; PR 3 passes an
    `AsyncPostgresSaver` so an interrupted run can resume in a different process.
    """
    builder = StateGraph(RunState)
    builder.add_node("seed", instrumented("seed", seed))
    builder.add_edge(START, "seed")
    builder.add_edge("seed", END)
    return builder.compile(checkpointer=checkpointer)
