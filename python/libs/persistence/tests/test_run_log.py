"""The in-memory run log refuses the same transitions the SQL functions do.

`test_runs_rls.py` holds the database half. Both walk `TRANSITIONS`, so a rule changed in one
place and not the other fails here rather than in a service test that happened to use memory.
"""

import pytest

from artloupe.persistence import InMemoryRunLog, RunTransitionRefused

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="data")

RUN = "33333333-3333-4333-8333-333333333333"

# (events already recorded, the next event, whether it is accepted)
TRANSITIONS = [
    ((), "started", True),
    ((), "failed", True),
    ((), "node_started", False),
    ((), "succeeded", False),
    (("started",), "started", False),
    (("started",), "node_started", True),
    (("started",), "node_finished", True),
    (("started",), "succeeded", True),
    (("started",), "failed", True),
    (("started", "succeeded"), "failed", False),
    (("started", "succeeded"), "node_started", False),
    (("failed",), "started", False),
    (("started", "failed"), "succeeded", False),
]


@pytest.mark.parametrize(("history", "kind", "accepted"), TRANSITIONS)
async def test_transitions(history: tuple[str, ...], kind: str, accepted: bool) -> None:
    log = InMemoryRunLog()
    await log.create(run_id=RUN, project_id="project", owner="owner")
    for earlier in history:
        await log.record(RUN, earlier)  # type: ignore[arg-type]

    if accepted:
        assert await log.record(RUN, kind) == len(history) + 1  # type: ignore[arg-type]
    else:
        with pytest.raises(RunTransitionRefused):
            await log.record(RUN, kind)  # type: ignore[arg-type]


async def test_an_unknown_run_cannot_be_recorded() -> None:
    with pytest.raises(RunTransitionRefused):
        await InMemoryRunLog().record(RUN, "started")


@pytest.mark.trace(flow="platform.agent-runtime", category="security")
async def test_a_reader_sees_only_its_owners_runs() -> None:
    log = InMemoryRunLog()
    await log.create(run_id=RUN, project_id="project", owner="owner-a")
    await log.record(RUN, "started")

    assert await log.reader_for("owner-a").run_visible(RUN)
    assert not await log.reader_for("owner-b").run_visible(RUN)
    assert await log.reader_for("owner-b").run_events_after(RUN, 0) == []
    assert [event.seq for event in await log.reader_for("owner-a").run_events_after(RUN, 0)] == [1]
