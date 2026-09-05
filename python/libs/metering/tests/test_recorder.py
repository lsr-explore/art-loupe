"""What the ledger records, and what it refuses to let a run keep spending.

Tagged `ops.observability` because the subject is the ledger itself — the numbers an operator
reads. The guards that *use* those numbers to stop a run are `test_guards.py`, which is
`platform.agent-runtime`: a run that does not stop is a runtime failure, where a run recorded
wrongly is a reporting one.
"""

import asyncio
from decimal import Decimal

import pytest

from artloupe.metering.guards import BudgetExceeded, RunGuards
from artloupe.metering.pricing import estimate_cost_usd
from artloupe.metering.recorder import RunRecorder, record_usage

pytestmark = pytest.mark.trace(flow="ops.observability", category="functionality")

GENEROUS = RunGuards(
    recursion_limit=25, node_visit_limit=10, wall_clock_seconds=30.0, token_ceiling=1_000_000
)


def recorder(guards: RunGuards = GENEROUS) -> RunRecorder:
    return RunRecorder(run_id="run-1", owner="artist-1", guards=guards)


async def test_a_node_that_reports_nothing_still_produces_a_row() -> None:
    """Most of slice 1 is deterministic. A silent node must not be an absent node.

    If unmetered nodes produced no row, the operations table would show only the expensive
    ones and the latency profile would be a fiction.
    """
    run = recorder()
    async with run.node("plates"):
        pass

    assert len(run.metrics) == 1
    metric = run.metrics[0]
    assert metric.node == "plates"
    assert metric.model is None
    assert metric.total_tokens == 0
    assert metric.cost_usd == Decimal("0")


async def test_latency_is_measured_not_declared() -> None:
    run = recorder()
    async with run.node("slow"):
        await asyncio.sleep(0.02)

    assert run.metrics[0].duration_ms >= 15


async def test_usage_reported_from_inside_the_node_lands_on_that_node() -> None:
    """The `ContextVar` handoff — the mechanism a provider callback will use."""
    run = recorder()
    async with run.node("analyse"):
        record_usage(model="claude-opus-5", input_tokens=1_000, output_tokens=500)

    metric = run.metrics[0]
    assert metric.model == "claude-opus-5"
    assert metric.input_tokens == 1_000
    assert metric.output_tokens == 500
    assert metric.cost_usd == Decimal("0.0175")


async def test_two_calls_in_one_node_accumulate() -> None:
    run = recorder()
    async with run.node("analyse"):
        record_usage(model="claude-opus-5", input_tokens=100, output_tokens=10)
        record_usage(model="claude-opus-5", input_tokens=200, output_tokens=20)

    assert run.metrics[0].input_tokens == 300
    assert run.metrics[0].output_tokens == 30


async def test_reporting_usage_outside_a_node_is_a_no_op() -> None:
    """A node has to stay callable directly in a unit test.

    If this raised, the lesson people would learn is to stop instrumenting nodes.
    """
    record_usage(model="claude-opus-5", input_tokens=10)


async def test_re_running_a_node_writes_a_second_row_rather_than_merging() -> None:
    """A resumed run re-executes the whole node containing `interrupt()`.

    Merging the two would hide the double charge that hazard causes, which is the single most
    likely way this ledger comes to under-report.
    """
    run = recorder()
    async with run.node("analyse"):
        record_usage(model="claude-opus-5", input_tokens=100)
    async with run.node("analyse"):
        record_usage(model="claude-opus-5", input_tokens=100)

    assert [metric.attempt for metric in run.metrics] == [1, 2]


async def test_cached_tokens_count_toward_the_ceiling_but_not_at_the_full_rate() -> None:
    """Both halves of the split, asserted together because either alone looks arbitrary.

    `BudgetLedger` has no cache field, so cached tokens are folded into `input_tokens` for the
    ceiling — a ceiling that ignored a large cached prefix read on every hop would not be one.
    Cost keeps them apart, because the rates differ.
    """
    run = recorder()
    async with run.node("analyse"):
        record_usage(model="claude-opus-5", input_tokens=100, cache_read_tokens=1_000)

    assert run.ledger.input_tokens == 1_100
    assert run.ledger.cache_hits == 1
    assert run.metrics[0].cache_read_tokens == 1_000
    assert run.metrics[0].cost_usd == estimate_cost_usd(
        "claude-opus-5", input_tokens=100, cache_read_tokens=1_000
    )


async def test_a_failing_node_is_still_recorded_and_reraises() -> None:
    """The runs worth reading in operations are disproportionately the ones that broke."""
    run = recorder()
    with pytest.raises(ValueError, match="boom"):
        async with run.node("analyse"):
            raise ValueError("boom")

    metric = run.metrics[0]
    assert metric.status == "error"
    assert metric.error == "ValueError: boom"


async def test_a_stopped_run_records_why_it_stopped() -> None:
    """`BudgetLedger` refuses to be marked stopped with no reason; assert we supply a real one."""
    run = recorder(RunGuards(25, 10, 30.0, token_ceiling=100))
    with pytest.raises(BudgetExceeded):
        async with run.node("analyse"):
            record_usage(model="claude-opus-5", input_tokens=500)

    assert run.ledger.stopped is True
    assert "ceiling of 100" in (run.ledger.stop_reason or "")
    assert "analyse" in (run.ledger.stop_reason or "")


async def test_unpriced_nodes_are_counted_rather_than_blanking_the_run() -> None:
    run = recorder()
    async with run.node("analyse"):
        record_usage(model="claude-opus-5", input_tokens=100_000)
    async with run.node("critique"):
        record_usage(model="claude-not-yet-released", input_tokens=100_000)

    assert run.cost_usd == Decimal("0.50")
    assert run.unpriced_nodes == 1
