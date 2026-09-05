"""The object the graph carries between nodes.

Deliberately minimal. `agents.md` §3 sketches the finished `RunState` — intent, findings,
lessons, plan, verdict, corrections, transcript, budget — and none of that exists yet. Adding
those fields now would mean inventing shapes ahead of the contracts that define them, and a
half-populated state object is harder to reason about than an honest small one.

What *is* fixed here is the part later slices cannot cheaply change:

- `run_id` is stable across the studio, the agent, and operations (NFR-09). One id, traced
  end to end, is what makes an operations row correspond to something an artist saw.
- `owner` is the Supabase subject — the value Postgres RLS reads as `auth.uid()`. It is
  copied from the *verified* token and never from a request body, so a caller cannot assert
  whose run this is.
- `node_trail` accumulates rather than overwrites. It is the reducer that proves the graph
  actually executed, and it is what makes the interrupt work in PR 13 legible: after a
  resume, the trail shows which nodes re-ran.
"""

import operator
from typing import Annotated, TypedDict


class RunState(TypedDict):
    """State for one studio run.

    A `TypedDict` rather than a Pydantic model, matching LangGraph's own convention: the
    graph merges partial updates per key, and a validating model would fight that by
    demanding whole objects on every node return.
    """

    run_id: str
    owner: str
    # `operator.add` makes this the one accumulating field. Every other key a node returns
    # replaces the previous value; this one appends, so the trail is the run's history.
    node_trail: Annotated[list[str], operator.add]
