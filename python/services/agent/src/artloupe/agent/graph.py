"""The studio graph: route and analyse the photograph, then plan and critique.

```text
START → load_project → face_gate → survey → direct → analyse
      → interpret → gather_lessons → plan → critique ─┬─→ END
                          ▲            ▲              │
                          └────────────┴── REVISE ────┘  (at most once, FR-704)
```

`direct` is the Studio Director's seat. The face gate decides head construction, and the model
decides every other tool (`artloupe.agent.routing`, `docs/design/routing-plan.md`). The four
nodes after `analyse` are the Visual Analyst's judgement, the lesson source, the Studio Planner
and the Plan Critic (`artloupe.agent.plan_nodes`). `direct`, `interpret`, `plan` and `critique`
spend tokens; every other node records a real zero.

The shape that matters and will not change:

- `build_graph(checkpointer=None)` takes its checkpointer by injection rather than building
  one. The Postgres saver is a process-wide singleton owned outside the graph — a graph that
  constructed its own would open a connection pool per call. The sibling repo `veloce-trace`
  settled on this same signature for the same reason.
- Nodes return *partial* state. `RunState.node_trail` accumulates via its reducer; returning
  the whole state from a node would fight that.
- `reported(...)` wraps outside `instrumented(...)`. It appends the node's start and finish to
  the run log, outside the measured span, so a slow log write is not billed to the node.
- Every node is registered through `instrumented(...)`. Wrapping at registration rather than
  in the node bodies is what makes "unmetered node" a thing you can see in a diff: an
  `add_node` call without the wrapper stands out, where a missing decorator inside a function
  does not. A node that is not wrapped costs money nobody can attribute.

The guards themselves are not applied here. `recursion_limit` and the wall-clock deadline
belong to the *invocation*, not the topology, so they live in `artloupe.agent.runtime` —
which is the only thing that should ever call `ainvoke` on this graph.
"""

from langgraph.graph import END, START, StateGraph

from artloupe.agent.nodes import analyse, face_gate, load_project, survey
from artloupe.agent.plan_nodes import after_critique, critique, gather_lessons, interpret, plan
from artloupe.agent.progress import reported
from artloupe.agent.routing import direct
from artloupe.agent.state import RunState
from artloupe.metering import instrumented

# In execution order. Each runs into the next, and the last one branches (`after_critique`).
NODES = (
    ("load_project", load_project),
    ("face_gate", face_gate),
    ("survey", survey),
    ("direct", direct),
    ("analyse", analyse),
    ("interpret", interpret),
    ("gather_lessons", gather_lessons),
    ("plan", plan),
    ("critique", critique),
)


def build_graph(checkpointer=None):
    """Compile the studio graph.

    `checkpointer` is `None` in tests and for stateless calls; a real interrupt passes an
    `AsyncPostgresSaver` so the run can resume in a different process.
    """
    builder = StateGraph(RunState)
    for name, node in NODES:
        builder.add_node(name, reported(name, instrumented(name, node)))

    builder.add_edge(START, NODES[0][0])
    for (earlier, _), (later, _) in zip(NODES, NODES[1:], strict=False):
        builder.add_edge(earlier, later)
    builder.add_conditional_edges(
        "critique",
        after_critique,
        {"gather_lessons": "gather_lessons", "plan": "plan", "__end__": END},
    )
    return builder.compile(checkpointer=checkpointer)
