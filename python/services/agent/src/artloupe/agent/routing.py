"""The Studio Director's seat: the gate decides head construction, and the model decides the rest.

FR-307 reads "tool selection is a decision, not a fixture." Two halves make that true here.

- **The gate's half is deterministic and final.** When no face was found, `head_construction` is
  declined with the gate's own reason. It is never offered to the model, so no model slip can
  select it, and `RoutingDecision` refuses that selection besides.
- **The model's half is a real decision.** Every other tool is offered to the Director
  (`artloupe.agent.director`), which selects or declines each one and says why.

The model's answer is checked here, at the producer, against the tools it was actually offered
(`check_accounts_for`, routing-plan §10 question 2). An answer that leaves a tool out, names one
twice, or names one it was not offered stops the run. Filling in the missing half would be the
fixture FR-307 forbids.
"""

from typing import Any

from pydantic import ValidationError

from artloupe.agent.director import RoutingFailed, ask_director
from artloupe.agent.resources import run_resources
from artloupe.agent.state import RunState
from artloupe.schemas import (
    TOOLS,
    IncompleteManifest,
    RoutingDecision,
    RoutingGate,
    ToolDeclination,
    ToolManifest,
    check_accounts_for,
)


async def direct(state: RunState) -> dict[str, Any]:
    """Route the run: pre-decline what the gate ruled out, and ask the Director about the rest."""
    gate = state["gate"]
    face_found = gate["face_found"]
    offered = [tool for tool in TOOLS if face_found or tool != "head_construction"]
    pre_declined = (
        [] if face_found else [ToolDeclination(tool="head_construction", reason=gate["reason"])]
    )

    director = run_resources().director
    if director is None:
        raise RuntimeError("this run has no Director client; the service supplies one per run")
    decision = await ask_director(
        director, intent=state["intent"], gate=gate, survey=state["survey"], offered=offered
    )

    try:
        answered = ToolManifest(selected=decision.selected, declined=decision.declined)
        check_accounts_for(answered, offered)
    except (ValidationError, IncompleteManifest) as error:
        raise RoutingFailed(
            "the Director's decision does not account for every offered tool exactly once"
        ) from error

    routing = RoutingDecision(
        manifest=ToolManifest(
            selected=answered.selected, declined=[*pre_declined, *answered.declined]
        ),
        rationale=decision.rationale,
        gate=RoutingGate(face_found=face_found, reason=None if face_found else gate["reason"]),
    )
    return {"routing": routing.model_dump(mode="json"), "node_trail": ["direct"]}
