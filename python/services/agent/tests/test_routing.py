"""The Director's stand-in: the gate's half of FR-307 is real; the rest is a labelled fixture.

What is pinned here outlives the stand-in. PR 12b replaces `direct` with the model-driven
Director, and the gate's rule — no face, no head construction, with the gate's reason — must
still hold when it does.
"""

import pytest

from artloupe.agent.routing import direct
from artloupe.schemas import TOOLS, ToolManifest

pytestmark = pytest.mark.trace(flow="intake.project-intent", category="functionality")

NO_FACE = {"face_found": False, "reason": "No face was found."}
FACE = {"face_found": True, "reason": None}


def _manifest(gate: dict) -> ToolManifest:
    return ToolManifest.model_validate(direct({"gate": gate})["manifest"])


@pytest.mark.parametrize("gate", [NO_FACE, FACE], ids=["no-face", "face"])
def test_every_tool_is_accounted_for_exactly_once(gate: dict) -> None:
    """An omitted tool is a silent declination, which FR-307 forbids."""
    manifest = _manifest(gate)

    named = [entry.tool for entry in manifest.selected] + [
        entry.tool for entry in manifest.declined
    ]
    assert sorted(named) == sorted(TOOLS)


def test_no_face_declines_head_construction_with_the_gates_reason() -> None:
    manifest = _manifest(NO_FACE)

    assert [(entry.tool, entry.reason) for entry in manifest.declined] == [
        ("head_construction", "No face was found.")
    ]


def test_a_face_makes_head_construction_eligible() -> None:
    manifest = _manifest(FACE)

    assert "head_construction" in {entry.tool for entry in manifest.selected}
    assert manifest.declined == []
