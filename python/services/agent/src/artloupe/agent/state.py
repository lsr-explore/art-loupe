"""The object the graph carries between nodes.

`agents.md` §3 sketches the finished `RunState` — intent, findings, lessons, plan, verdict,
corrections, transcript, budget. This holds only what the routing slice produces, so no field
is invented ahead of the contract that defines it.

What is fixed here, and later slices cannot cheaply change:

- `run_id` is stable across the studio, the agent, and operations (NFR-09). One id, traced
  end to end, is what makes an operations row correspond to something an artist saw.
- `owner` is the Supabase subject — the value Postgres RLS reads as `auth.uid()`. It is
  copied from the *verified* token and never from a request body, so a caller cannot assert
  whose run this is.
- `node_trail` accumulates rather than overwrites. It is the reducer that proves the graph
  actually executed, and it is what makes the interrupt work in PR 13 legible: after a
  resume, the trail shows which nodes re-ran.

**Everything here is checkpointed, so everything here is plain JSON.** Two things a run needs are
deliberately absent: the artist's bearer token, and the decoded photograph. The token would
outlive its own expiry inside a stored checkpoint; the photograph would be rewritten on every
superstep. Both live in `artloupe.agent.resources` instead, beside the state and never in it.
"""

import operator
from typing import Annotated, Any, NotRequired, TypedDict


class RunState(TypedDict):
    """State for one studio run.

    A `TypedDict` rather than a Pydantic model, matching LangGraph's own convention: the
    graph merges partial updates per key, and a validating model would fight that by
    demanding whole objects on every node return.
    """

    run_id: str
    owner: str
    # The project this run analyses. The run reads it as the artist, through their own token.
    project_id: str
    # `operator.add` makes this the one accumulating field. Every other key a node returns
    # replaces the previous value; this one appends, so the trail is the run's history.
    node_trail: Annotated[list[str], operator.add]

    # Filled in node order. Each is the JSON form of a validated contract, never a live object.
    #
    # `load_project`: the FR-105 checksum every artifact cites, the validated `ProjectIntent`,
    # and the decoded photograph's size in its displayed orientation.
    source_checksum: NotRequired[str]
    intent: NotRequired[dict[str, Any]]
    image_size: NotRequired[dict[str, int]]
    # `face_gate`: whether a face was found, and the gate's own reason when it was not.
    gate: NotRequired[dict[str, Any]]
    # `survey`: the first-pass figures the Director reads, each quoted from FR-305 metadata.
    survey: NotRequired[dict[str, Any]]
    # `direct`: the `RoutingDecision` — what runs and what was declined and why (FR-307), the
    # rationale the artist reads, and the gate's half kept apart from the model's.
    routing: NotRequired[dict[str, Any]]
    # `analyse`: the FR-305 `ArtifactMetadata` of every selected tool, in `TOOLS` order.
    artifacts: NotRequired[list[dict[str, Any]]]
