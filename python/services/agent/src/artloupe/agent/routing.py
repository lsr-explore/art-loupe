"""The Studio Director's seat, held by a deterministic stand-in until PR 12b.

**This does not meet FR-307, and says so.** FR-307 reads "tool selection is a decision, not a
fixture." This stand-in selects every tool the gate allows, which is a fixture. PR 12b replaces
this one node with the model-driven Director (`docs/design/routing-plan.md` §9); nothing else in
the graph changes when it does.

The gate's half of the decision is already real and final. When the gate found no face,
`head_construction` is declined with the gate's own reason, and 12b's Director will not be offered
it. That part is deterministic by design and stays that way.
"""

from typing import Any

from artloupe.agent.state import RunState
from artloupe.schemas import TOOLS, ToolDeclination, ToolManifest, ToolSelection


def direct(state: RunState) -> dict[str, Any]:
    """Every tool once: `head_construction` declined when there is no face, everything else
    selected. A placeholder for the Director — see the module docstring before relying on it."""
    gate = state["gate"]
    selected: list[ToolSelection] = []
    declined: list[ToolDeclination] = []
    for tool in TOOLS:
        if tool == "head_construction" and not gate["face_found"]:
            declined.append(ToolDeclination(tool=tool, reason=gate["reason"]))
        else:
            selected.append(ToolSelection(tool=tool))

    manifest = ToolManifest(selected=selected, declined=declined)
    return {"manifest": manifest.model_dump(mode="json"), "node_trail": ["direct"]}
