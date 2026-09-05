"""The four ceilings, and that each one stops a run the others would not.

Tagged `platform.agent-runtime`: a guard that does not fire is a graph-execution failure — a
run that never terminates, or one that spends past its budget — not a reporting one.
"""

import asyncio

import pytest

from artloupe.metering.config import MeteringSettings
from artloupe.metering.guards import (
    BudgetExceeded,
    GuardTripped,
    NodeVisitLimitExceeded,
    RunGuards,
    WallClockExceeded,
)
from artloupe.metering.recorder import RunRecorder, record_usage

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")


def recorder(**overrides: object) -> RunRecorder:
    defaults = {
        "recursion_limit": 25,
        "node_visit_limit": 10,
        "wall_clock_seconds": 30.0,
        "token_ceiling": 1_000_000,
    }
    return RunRecorder(
        run_id="run-1", owner="artist-1", guards=RunGuards(**{**defaults, **overrides})
    )


async def test_the_token_ceiling_stops_the_run() -> None:
    """NFR-04's hard stop. Checked *after* a node, because its tokens are what crossed it."""
    run = recorder(token_ceiling=1_000)
    with pytest.raises(BudgetExceeded, match="plan budget exhausted"):
        async with run.node("analyse"):
            record_usage(model="claude-opus-5", input_tokens=2_000)


async def test_a_stopped_run_refuses_to_start_another_node() -> None:
    """The stop has to hold, not merely be reported once.

    Refusing at the boundary means the next node does no partial work and charges nothing —
    a hard stop that let one more node run would be a warning, not a stop.
    """
    run = recorder(token_ceiling=1_000)
    with pytest.raises(BudgetExceeded):
        async with run.node("analyse"):
            record_usage(model="claude-opus-5", input_tokens=2_000)

    with pytest.raises(BudgetExceeded):
        async with run.node("critique"):
            pytest.fail("a stopped run must not enter another node")


async def test_one_node_may_not_run_more_times_than_the_limit() -> None:
    run = recorder(node_visit_limit=2)
    async with run.node("loop"):
        pass
    async with run.node("loop"):
        pass

    with pytest.raises(NodeVisitLimitExceeded, match="loop"):
        async with run.node("loop"):
            pytest.fail("the third execution must be refused")


async def test_the_visit_limit_is_per_node_not_per_run() -> None:
    """Otherwise a wide graph would trip a loop guard by being wide."""
    run = recorder(node_visit_limit=1)
    async with run.node("first"):
        pass
    async with run.node("second"):
        pass

    assert [metric.node for metric in run.metrics] == ["first", "second"]


@pytest.mark.trace(flow="platform.agent-runtime", category="performance")
async def test_the_deadline_stops_the_next_node() -> None:
    """Bounding elapsed time, which neither the recursion nor the visit cap does.

    Enforced at the boundary rather than by cancellation: a node cancelled mid-flight leaves a
    checkpoint with the node half-applied, and this run has to stay resumable.
    """
    run = recorder(wall_clock_seconds=0.02)
    async with run.node("first"):
        await asyncio.sleep(0.05)

    with pytest.raises(WallClockExceeded, match="deadline"):
        async with run.node("second"):
            pytest.fail("a run past its deadline must not enter another node")


async def test_a_guard_stop_is_recorded_distinctly_from_an_error() -> None:
    """A budget working as designed must not read as a fault in the error rate."""
    run = recorder(token_ceiling=1_000)
    with pytest.raises(BudgetExceeded):
        async with run.node("analyse"):
            record_usage(model="claude-opus-5", input_tokens=2_000)
    with pytest.raises(BudgetExceeded):
        async with run.node("critique"):
            pass

    assert [metric.status for metric in run.metrics] == ["ok", "guard_stopped"]


def test_every_guard_shares_one_catchable_family() -> None:
    """So a caller can handle "the run was stopped" without enumerating the reasons."""
    for failure in (BudgetExceeded, WallClockExceeded, NodeVisitLimitExceeded):
        assert issubclass(failure, GuardTripped)


def test_guards_come_from_configuration_not_constants() -> None:
    """A demo has to be able to tighten a ceiling and show the hard stop firing."""
    settings = MeteringSettings(
        artloupe_run_recursion_limit=3,
        artloupe_run_node_visit_limit=2,
        artloupe_run_wall_clock_seconds=1.5,
        artloupe_plan_token_ceiling=42,
    )
    guards = RunGuards.from_settings(settings)
    assert guards == RunGuards(
        recursion_limit=3, node_visit_limit=2, wall_clock_seconds=1.5, token_ceiling=42
    )


def test_the_defaults_would_not_fire_on_a_normal_run() -> None:
    """A guard that trips in normal operation gets raised until it stops guarding anything.

    NFR-03 budgets p95 45-60s cold for the full plan graph, so the deadline has to clear it.
    """
    guards = RunGuards.from_settings(MeteringSettings())
    assert guards.wall_clock_seconds >= 60
    assert guards.token_ceiling >= 100_000
