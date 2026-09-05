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

Not here yet, and deliberately: `recursion_limit`, a wall-clock deadline, and the budget
ledger's hard stop all land in PR 4. A single-node graph cannot loop, so there is nothing for
them to bound today — but nothing here should grow a second edge before they exist.
"""

from langgraph.graph import END, START, StateGraph

from artloupe.agent.state import RunState


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
    builder.add_node("seed", seed)
    builder.add_edge(START, "seed")
    builder.add_edge("seed", END)
    return builder.compile(checkpointer=checkpointer)
