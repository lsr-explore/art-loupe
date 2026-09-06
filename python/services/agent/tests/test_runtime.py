"""Running the graph under its guards.

The unit-level behaviour of the recorder and each ceiling lives in `libs/metering`. What is
asserted here is the wiring that cannot be tested there, because `artloupe-metering` knows
nothing about LangGraph: that the caps reach the invocation, that LangGraph's own recursion
error joins the same exception family, and that the ledger survives a run that did not.
"""

import pytest
from langgraph.graph import END, START, StateGraph

from artloupe.agent.graph import build_graph
from artloupe.agent.runtime import execute_run
from artloupe.agent.state import RunState
from artloupe.metering import (
    InMemoryMetricsSink,
    NodeVisitLimitExceeded,
    RecursionLimitExceeded,
    RunGuards,
    instrumented,
    record_usage,
)

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")

GENEROUS = RunGuards(
    recursion_limit=25, node_visit_limit=10, wall_clock_seconds=30.0, token_ceiling=1_000_000
)


def looping_node(state: RunState) -> dict[str, list[str]]:
    """A node that never converges — the thing every loop guard exists to stop."""
    return {"node_trail": ["loop"]}


def build_looping_graph():
    builder = StateGraph(RunState)
    builder.add_node("loop", instrumented("loop", looping_node))
    builder.add_edge(START, "loop")
    builder.add_edge("loop", "loop")
    return builder.compile()


def failing_node(_state: RunState) -> dict[str, list[str]]:
    raise RuntimeError("node exploded")


def build_failing_graph():
    builder = StateGraph(RunState)
    builder.add_node("boom", instrumented("boom", failing_node))
    builder.add_edge(START, "boom")
    builder.add_edge("boom", END)
    return builder.compile()


def spending_node(_state: RunState) -> dict[str, list[str]]:
    record_usage(model="claude-opus-5", input_tokens=5_000, output_tokens=1_000)
    return {"node_trail": ["spend"]}


def build_spending_graph():
    builder = StateGraph(RunState)
    builder.add_node("spend", instrumented("spend", spending_node))
    builder.add_edge(START, "spend")
    builder.add_edge("spend", END)
    return builder.compile()


def initial(run_id: str = "run-1") -> RunState:
    return {"run_id": run_id, "owner": "artist-1", "node_trail": []}


async def test_a_run_produces_a_row_per_node_carrying_its_run_id() -> None:
    """NFR-09 at the only point it can break: the ledger row and the state must agree.

    A row keyed on anything other than the run id the artist was shown makes an operations
    figure unattributable, which is the whole point of the identifier.
    """
    sink = InMemoryMetricsSink()
    outcome = await execute_run(
        build_graph(),
        initial("run-9"),
        run_id="run-9",
        owner="artist-1",
        guards=GENEROUS,
        sink=sink,
    )

    assert outcome.state["node_trail"] == ["seed:run-9"]
    assert [metric.node for metric in outcome.metrics] == ["seed"]
    assert {metric.run_id for metric in sink.metrics} == {"run-9"}
    assert sink.metrics[0].owner == "artist-1"


async def test_a_deterministic_run_costs_a_measured_zero() -> None:
    """Not an absent number. Slice 1 is almost entirely deterministic, so the common case is
    a run whose cost is genuinely zero — and that has to be distinguishable from unmetered."""
    outcome = await execute_run(
        build_graph(),
        initial(),
        run_id="run-1",
        owner="artist-1",
        guards=GENEROUS,
        sink=InMemoryMetricsSink(),
    )
    assert outcome.cost_usd == 0
    assert outcome.ledger.input_tokens == 0
    assert outcome.ledger.stopped is False


async def test_usage_recorded_inside_a_node_reaches_the_run_ledger() -> None:
    """The end-to-end path a real model call will take, with the call itself stubbed out."""
    outcome = await execute_run(
        build_spending_graph(),
        initial(),
        run_id="run-1",
        owner="artist-1",
        guards=GENEROUS,
        sink=InMemoryMetricsSink(),
    )

    assert outcome.ledger.input_tokens == 5_000
    assert outcome.ledger.output_tokens == 1_000
    assert outcome.metrics[0].model == "claude-opus-5"
    assert outcome.cost_usd > 0


async def test_langgraphs_recursion_error_joins_the_guard_family() -> None:
    """One exception family for "the run was stopped", rather than two names for it.

    The limit is passed explicitly rather than left to LangGraph's default so the cap is a
    stated decision — and so this assertion is about our number, not the library's.
    """
    guards = RunGuards(
        recursion_limit=3, node_visit_limit=50, wall_clock_seconds=30.0, token_ceiling=1_000_000
    )
    with pytest.raises(RecursionLimitExceeded, match="3 supersteps"):
        await execute_run(
            build_looping_graph(),
            initial(),
            run_id="run-1",
            owner="artist-1",
            guards=guards,
            sink=InMemoryMetricsSink(),
        )


async def test_the_per_node_cap_fires_first_and_names_the_node() -> None:
    """Why both caps exist. The recursion limit says a run would not stop; this says which
    node would not stop, which is the difference between a bug report and a mystery."""
    guards = RunGuards(
        recursion_limit=50, node_visit_limit=2, wall_clock_seconds=30.0, token_ceiling=1_000_000
    )
    with pytest.raises(NodeVisitLimitExceeded, match="'loop'"):
        await execute_run(
            build_looping_graph(),
            initial(),
            run_id="run-1",
            owner="artist-1",
            guards=guards,
            sink=InMemoryMetricsSink(),
        )


async def test_the_ledger_is_written_even_when_the_run_fails() -> None:
    """The runs operations most needs are the ones that stopped.

    A ledger flushed only on the success path is missing exactly the rows someone is looking
    for when they open the dashboard.
    """
    sink = InMemoryMetricsSink()
    with pytest.raises(RuntimeError, match="node exploded"):
        await execute_run(
            build_failing_graph(),
            initial(),
            run_id="run-1",
            owner="artist-1",
            guards=GENEROUS,
            sink=sink,
        )

    assert [metric.status for metric in sink.metrics] == ["error"]
    assert sink.metrics[0].error == "RuntimeError: node exploded"


async def test_a_sink_that_fails_does_not_fail_the_run() -> None:
    """Losing an operations row is bad; discarding a finished analysis over one is worse."""

    class BrokenSink:
        async def flush(self, metrics: object) -> None:
            raise ConnectionError("database unreachable")

    outcome = await execute_run(
        build_graph(),
        initial(),
        run_id="run-1",
        owner="artist-1",
        guards=GENEROUS,
        sink=BrokenSink(),
    )
    assert outcome.state["node_trail"] == ["seed:run-1"]


async def test_a_graph_invoked_without_a_recorder_still_runs() -> None:
    """Instrumentation must not become the reason a node cannot be unit-tested on its own."""
    result = await build_graph().ainvoke(initial())
    assert result["node_trail"] == ["seed:run-1"]
