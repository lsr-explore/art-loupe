"""The studio graph's shape, and whole runs through it with the artist's data stood in for.

Topology is asserted separately from behaviour on purpose: a node silently dropped from the
graph and a node that runs but returns nothing look identical from the outside, and only the
first is caught by checking the compiled graph.

The runs use the real plate and perspective tools on a drawn photograph. The face detector and
the Loomis construction are stubbed (`conftest.py`), so no test here sends Google anything.
"""

import json

import pytest
from agent_support import (
    OWNER,
    PROJECT_ID,
    SENTINEL_TOKEN,
    Detector,
    FakeArtistApi,
    synthetic_face,
)

from artloupe.agent.graph import build_graph
from artloupe.agent.nodes import ProjectNotReady
from artloupe.agent.resources import RunResources
from artloupe.agent.runtime import RunOutcome, execute_run
from artloupe.image_tools import LIMITATION_NO_FACE
from artloupe.metering import InMemoryMetricsSink, RunGuards
from artloupe.schemas import TOOLS

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")

IN_ORDER = ["load_project", "face_gate", "survey", "direct", "analyse"]

GENEROUS = RunGuards(
    recursion_limit=25, node_visit_limit=10, wall_clock_seconds=60.0, token_ceiling=1_000_000
)


async def run(api: FakeArtistApi, *, trail: list[str] | None = None) -> RunOutcome:
    return await execute_run(
        build_graph(),
        {"run_id": "run-1", "owner": OWNER, "project_id": PROJECT_ID, "node_trail": trail or []},
        run_id="run-1",
        owner=OWNER,
        guards=GENEROUS,
        sink=InMemoryMetricsSink(),
        resources=RunResources(api=api),  # type: ignore[arg-type]  # the in-memory stand-in
    )


def test_the_graph_is_the_five_nodes_in_order() -> None:
    edges = {(edge.source, edge.target) for edge in build_graph().get_graph().edges}

    path = ["__start__", *IN_ORDER, "__end__"]
    assert edges == set(zip(path, path[1:], strict=False))


def test_graph_accepts_an_injected_checkpointer_slot() -> None:
    """A real interrupt passes an AsyncPostgresSaver here; the signature has to exist first."""
    assert build_graph(checkpointer=None) is not None


async def test_a_run_visits_every_node_once_and_spends_nothing(
    api: FakeArtistApi, detector: Detector
) -> None:
    """Every node in this slice is deterministic, so the ledger's zero is a measurement."""
    outcome = await run(api)

    assert outcome.state["node_trail"] == IN_ORDER
    assert [metric.node for metric in outcome.metrics] == IN_ORDER
    assert outcome.cost_usd == 0


async def test_node_trail_accumulates_rather_than_replaces(
    api: FakeArtistApi, detector: Detector
) -> None:
    """The reducer is what makes a resumed run legible in PR 13."""
    outcome = await run(api, trail=["earlier"])

    assert outcome.state["node_trail"] == ["earlier", *IN_ORDER]


@pytest.mark.trace(flow="intake.project-intent", category="functionality")
async def test_no_face_declines_head_construction_with_the_gates_reason(
    api: FakeArtistApi, detector: Detector
) -> None:
    """FR-307's deterministic half: the refusal is visible, and it says why."""
    outcome = await run(api)

    assert outcome.state["gate"] == {"face_found": False, "reason": LIMITATION_NO_FACE}
    assert outcome.state["manifest"]["declined"] == [
        {"tool": "head_construction", "reason": LIMITATION_NO_FACE}
    ]
    assert [artifact["tool"] for artifact in outcome.state["artifacts"]] == [
        tool for tool in TOOLS if tool != "head_construction"
    ]


@pytest.mark.trace(flow="analysis.geometry", category="functionality")
async def test_a_face_brings_head_construction_in_on_the_cached_face(
    api: FakeArtistApi, detector: Detector, head_construction: list
) -> None:
    detector.face = synthetic_face()

    outcome = await run(api)

    assert outcome.state["gate"]["face_found"] is True
    assert outcome.state["manifest"]["declined"] == []
    assert [artifact["tool"] for artifact in outcome.state["artifacts"]] == list(TOOLS)
    # Detected once, at the gate. `analyse` built the construction from the cache, not a rerun.
    assert detector.calls == 1
    assert head_construction == [synthetic_face()]


@pytest.mark.trace(flow="analysis.deterministic-studies", category="functionality")
async def test_every_artifact_cites_the_projects_original(
    api: FakeArtistApi, detector: Detector
) -> None:
    """FR-305: an artifact that cited any other checksum would be a claim about other bytes."""
    outcome = await run(api)

    checksums = {artifact["source_checksum"] for artifact in outcome.state["artifacts"]}
    assert checksums == {outcome.state["source_checksum"]}


async def test_the_photograph_is_downloaded_once_per_run(
    api: FakeArtistApi, detector: Detector
) -> None:
    await run(api)

    assert api.downloads == 1


async def test_a_second_run_rests_on_the_first_runs_cache(
    api: FakeArtistApi, detector: Detector
) -> None:
    """Reopening a study must not detect again — the #43 promise the cache exists to keep."""
    await run(api)
    stored_after_first = list(api.stores)

    await run(api)

    assert detector.calls == 1
    assert api.stores == stored_after_first


@pytest.mark.trace(flow="platform.agent-runtime", category="security")
async def test_the_state_holds_no_token_and_no_pixels(
    api: FakeArtistApi, detector: Detector
) -> None:
    """Everything in the state is checkpointed, so it must be plain JSON and hold no credential."""
    outcome = await run(api)

    checkpointed = json.dumps(outcome.state)
    assert SENTINEL_TOKEN not in checkpointed


async def test_a_project_with_no_photograph_is_not_ready(detector: Detector) -> None:
    with pytest.raises(ProjectNotReady, match="no reference photograph"):
        await run(FakeArtistApi(photograph=None))


async def test_a_project_with_no_intake_is_not_ready(detector: Detector) -> None:
    with pytest.raises(ProjectNotReady, match="intake"):
        await run(FakeArtistApi(intent=None))
