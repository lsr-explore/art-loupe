"""The deterministic nodes: load the project, gate on a face, survey, and analyse.

None of these spends a token. Each records a real zero in the ledger, which is the correct
measurement of a deterministic node rather than an absent one.

The tools are called inline. They are CPU-bound and take up to about a second on a full-size
photograph, so a run blocks its event loop while one works. That is acceptable for a local,
single-artist service; NFR-02 moves Tier B and C tools onto a queued worker when deployment is
real, and this is where that change lands.
"""

from typing import Any

from artloupe.agent.cache import cached_face, cached_perspective
from artloupe.agent.resources import decode_original, photograph, run_resources
from artloupe.agent.state import RunState
from artloupe.image_tools import (
    LIMITATION_NO_FACE,
    PlateSuite,
    head_from_face,
    make_plates,
)
from artloupe.schemas import TOOLS, ProjectIntent, RoutingDecision

# The four manifest tools one `make_plates` call produces.
PLATE_TOOLS = frozenset({"grayscale", "value_map", "value_shapes", "outline"})


class ProjectNotReady(RuntimeError):
    """The project has no original or no intake yet, so there is nothing to route."""


async def _plates(project_id: str, checksum: str) -> PlateSuite:
    """The plate suite, computed once per process and shared by the survey and `analyse`."""
    resources = run_resources()
    if resources.plates is None:
        image = await photograph(project_id, checksum)
        resources.plates = make_plates(image, source_checksum=checksum)
    return resources.plates


async def load_project(state: RunState) -> dict[str, Any]:
    """Read the project as the artist, and decode its original once for every later node."""
    resources = run_resources()
    project = await resources.api.load_project(state["project_id"])
    if project.source is None:
        raise ProjectNotReady("the project has no reference photograph yet")
    if project.intent is None:
        raise ProjectNotReady("the project's intake has not been completed")

    intent = ProjectIntent.model_validate(project.intent)
    data = await resources.api.download_original(project.source)
    resources.image = decode_original(data, checksum=project.source.checksum)
    height, width = resources.image.shape[:2]

    return {
        "source_checksum": project.source.checksum,
        "intent": intent.model_dump(mode="json"),
        "image_size": {"width": width, "height": height},
        "node_trail": ["load_project"],
    }


async def face_gate(state: RunState) -> dict[str, Any]:
    """The deterministic portrait gate (FR-307): a face was found, or it was not.

    Binary, free and reliable, so it stays off the model. When no face is found, the gate's reason
    is the detector's own stated limitation, which names the small-face case (#45).
    """
    face = await cached_face(state["project_id"], state["source_checksum"])
    if face is None:
        gate: dict[str, Any] = {"face_found": False, "reason": LIMITATION_NO_FACE}
    else:
        reliability = face.facial_landmark_reliability
        gate = {
            "face_found": True,
            "reason": None,
            "facial_landmark_reliability": reliability.value,
            "weakest": reliability.weakest,
            "face_height_px": reliability.face_height_px,
        }
    return {"gate": gate, "node_trail": ["face_gate"]}


async def survey(state: RunState) -> dict[str, Any]:
    """The first-pass figures the Director reads. Every one is a measurement, quoted with the
    FR-305 metadata that produced it, so the Director cites rather than describes (FR-305)."""
    project_id, checksum = state["project_id"], state["source_checksum"]
    perspective = await cached_perspective(project_id, checksum)
    plates = await _plates(project_id, checksum)

    return {
        "survey": {
            "perspective": {
                # Candidates below the confidence floor are already held back by the tool, so
                # this is the count that cleared it.
                "vanishing_points": len(perspective.vanishing_points),
                "confidences": [point.confidence.value for point in perspective.vanishing_points],
                "horizon_level_assumed": (
                    perspective.horizon.level_assumed if perspective.horizon else None
                ),
                "metadata": perspective.metadata.model_dump(mode="json"),
            },
            "values": {
                "thresholds": list(plates.values.thresholds),
                "shares": list(plates.values.shares),
                "metadata": plates.values.metadata.model_dump(mode="json"),
            },
        },
        "node_trail": ["survey"],
    }


async def analyse(state: RunState) -> dict[str, Any]:
    """Run what the manifest selected, and collect each artifact's FR-305 metadata.

    The execution half of the Visual Analyst (`agents.md` §4.2) only. Interpreting the results
    into `VisualFindings` arrives with the plan. A declined tool contributes nothing here, even
    where the pipeline computed it anyway.
    """
    manifest = RoutingDecision.model_validate(state["routing"]).manifest
    selected = {entry.tool for entry in manifest.selected}
    project_id, checksum = state["project_id"], state["source_checksum"]

    by_tool: dict[str, dict[str, Any]] = {}
    if selected & PLATE_TOOLS:
        plates = await _plates(project_id, checksum)
        plate_metadata = {
            "grayscale": plates.grayscale.metadata,
            "value_map": plates.values.metadata,
            "value_shapes": plates.value_shapes.metadata,
            "outline": plates.outline.metadata,
        }
        for tool in selected & PLATE_TOOLS:
            by_tool[tool] = plate_metadata[tool].model_dump(mode="json")
    if "perspective" in selected:
        perspective = await cached_perspective(project_id, checksum)
        by_tool["perspective"] = perspective.metadata.model_dump(mode="json")
    if "head_construction" in selected:
        face = await cached_face(project_id, checksum)
        size = state["image_size"]
        head = head_from_face(
            face, width=size["width"], height=size["height"], source_checksum=checksum
        )
        by_tool["head_construction"] = head.metadata.model_dump(mode="json")

    return {
        "artifacts": [by_tool[tool] for tool in TOOLS if tool in by_tool],
        "node_trail": ["analyse"],
    }
