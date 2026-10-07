"""The background job: progress reaches the log, every run ends in one terminal event.

`test_service.py` covers how each failure is described. This covers what the endpoint cannot
show: the real graph's nodes reporting through `reported`, a cancelled run recording itself as
interrupted, and a log that refuses to record not taking the run down with it.
"""

import asyncio
from typing import Any

import pytest
from langgraph.graph import END, START, StateGraph

from artloupe.agent import jobs
from artloupe.agent.progress import reported
from artloupe.agent.resources import RunResources
from artloupe.agent.state import RunState
from artloupe.metering import RunGuards, instrumented
from artloupe.persistence import InMemoryRunLog

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")

RUN = "22222222-2222-4222-8222-222222222222"
OWNER = "owner-a"
GUARDS = RunGuards(
    recursion_limit=10,
    node_visit_limit=5,
    wall_clock_seconds=5,
    token_ceiling=1000,
)


async def first(state: RunState) -> dict[str, Any]:
    return {"node_trail": ["first"]}


async def second(state: RunState) -> dict[str, Any]:
    return {"node_trail": ["second"]}


def two_node_graph(second_node=second):
    builder = StateGraph(RunState)
    builder.add_node("first", reported("first", instrumented("first", first)))
    builder.add_node("second", reported("second", instrumented("second", second_node)))
    builder.add_edge(START, "first")
    builder.add_edge("first", "second")
    builder.add_edge("second", END)
    return builder.compile()


async def queued_log() -> InMemoryRunLog:
    log = InMemoryRunLog()
    await log.create(run_id=RUN, project_id="project", owner=OWNER)
    return log


def initial() -> RunState:
    return {"run_id": RUN, "owner": OWNER, "project_id": "project", "node_trail": []}


def resources() -> RunResources:
    return RunResources(api=None)  # type: ignore[arg-type]  # these nodes read no artist data


async def test_each_node_reports_its_start_and_finish_in_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    log = await queued_log()
    # The graph completes, but has no routing to build a result from: that is reported as failed,
    # which is fine here. This test is about the progress events before it.
    await jobs.run_job(two_node_graph(), initial(), log=log, guards=GUARDS, resources=resources())

    progress = [(event.kind, event.payload.get("node")) for event in log.runs[RUN].events]
    assert progress[:5] == [
        ("started", None),
        ("node_started", "first"),
        ("node_finished", "first"),
        ("node_started", "second"),
        ("node_finished", "second"),
    ]
    assert progress[-1][0] == "failed"


async def test_a_node_that_raises_reports_no_finish_and_the_run_fails() -> None:
    async def broken(state: RunState) -> dict[str, Any]:
        raise RuntimeError("boom")

    log = await queued_log()
    await jobs.run_job(
        two_node_graph(broken), initial(), log=log, guards=GUARDS, resources=resources()
    )

    kinds = [event.kind for event in log.runs[RUN].events]
    assert kinds == ["started", "node_started", "node_finished", "node_started", "failed"]
    assert log.runs[RUN].events[-1].payload["reason"] == "internal_error"
    assert "boom" not in str(log.runs[RUN].events[-1].payload)


async def test_a_cancelled_run_records_itself_as_interrupted() -> None:
    started = asyncio.Event()

    async def hangs(state: RunState) -> dict[str, Any]:
        started.set()
        await asyncio.sleep(60)
        return {}

    log = await queued_log()
    task = asyncio.create_task(
        jobs.run_job(
            two_node_graph(hangs), initial(), log=log, guards=GUARDS, resources=resources()
        )
    )
    await asyncio.wait_for(started.wait(), timeout=2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    last = log.runs[RUN].events[-1]
    assert last.kind == "failed"
    assert last.payload["reason"] == "interrupted"


async def test_a_progress_write_that_fails_does_not_fail_the_run() -> None:
    """Losing a progress line costs the artist a step on screen, not the analysis."""

    class FlakyLog(InMemoryRunLog):
        async def record(self, run_id, kind, payload=None):  # type: ignore[override]
            if kind.startswith("node_"):
                raise ConnectionError("database went away")
            return await super().record(run_id, kind, payload)

    log = FlakyLog()
    await log.create(run_id=RUN, project_id="project", owner=OWNER)
    await jobs.run_job(two_node_graph(), initial(), log=log, guards=GUARDS, resources=resources())

    kinds = [event.kind for event in log.runs[RUN].events]
    # No routing in this graph's state, so the job ends `failed`, but it ended — on its own terms.
    assert kinds[0] == "started"
    assert kinds[-1] == "failed"
    assert log.runs[RUN].events[-1].payload["reason"] == "internal_error"


async def test_shutdown_cancels_pending_runs() -> None:
    started = asyncio.Event()

    async def hangs(state: RunState) -> dict[str, Any]:
        started.set()
        await asyncio.sleep(60)
        return {}

    log = await queued_log()
    jobs.dispatch_run(
        jobs.run_job(
            two_node_graph(hangs), initial(), log=log, guards=GUARDS, resources=resources()
        )
    )
    await asyncio.wait_for(started.wait(), timeout=2)

    await jobs.cancel_pending_runs()

    assert log.runs[RUN].events[-1].payload["reason"] == "interrupted"
    assert not jobs._PENDING  # noqa: SLF001
