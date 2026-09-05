"""The compiled graph's shape and its one accumulating field.

Topology is asserted separately from behaviour on purpose: a node silently dropped from the
graph and a node that runs but returns nothing look identical from the outside, and only the
first is caught by checking the compiled node set.
"""

import pytest

from artloupe.agent.graph import build_graph, seed

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")


def test_graph_compiles_with_the_expected_nodes() -> None:
    nodes = build_graph().get_graph().nodes
    assert "seed" in nodes


def test_graph_accepts_an_injected_checkpointer_slot() -> None:
    """PR 3 passes an AsyncPostgresSaver here; the signature has to exist before it does."""
    assert build_graph(checkpointer=None) is not None


async def test_running_the_graph_records_the_run() -> None:
    result = await build_graph().ainvoke({"run_id": "run-1", "owner": "user-1", "node_trail": []})
    assert result["node_trail"] == ["seed:run-1"]
    assert result["run_id"] == "run-1"
    assert result["owner"] == "user-1"


async def test_node_trail_accumulates_rather_than_replaces() -> None:
    """The reducer is what makes a resumed run legible in PR 13 — pin it now.

    Without `operator.add` on `node_trail` this returns `["seed:run-2"]` and the earlier
    history is silently gone, which is exactly the failure that would be discovered late.
    """
    result = await build_graph().ainvoke(
        {"run_id": "run-2", "owner": "user-1", "node_trail": ["earlier"]}
    )
    assert result["node_trail"] == ["earlier", "seed:run-2"]


def test_seed_returns_a_partial_update_not_whole_state() -> None:
    """A node returning full state would overwrite keys the reducer is meant to merge."""
    update = seed({"run_id": "run-3", "owner": "user-1", "node_trail": ["earlier"]})
    assert update == {"node_trail": ["seed:run-3"]}
