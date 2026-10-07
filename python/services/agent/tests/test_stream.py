"""The SSE stream: replay after a cursor, tail until the run ends, and never stay open forever.

Driven against the in-memory run log, with the poll interval shrunk so a tailing test takes
milliseconds rather than half-seconds.
"""

import asyncio
import time

import pytest

from artloupe.agent.stream import (
    MAX_STREAM_SECONDS,
    TOKEN_MARGIN_SECONDS,
    closes_at,
    follow,
    format_event,
    parse_cursor,
)
from artloupe.persistence import InMemoryRunLog, RunEvent

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")

RUN = "11111111-1111-4111-8111-111111111111"
OWNER = "owner-a"
FAR_FUTURE = time.time() + 3600


async def started_log() -> InMemoryRunLog:
    log = InMemoryRunLog()
    await log.create(run_id=RUN, project_id="project", owner=OWNER)
    await log.record(RUN, "started")
    return log


async def collect(stream, limit: int = 50) -> list[str]:
    frames = []
    async for frame in stream:
        frames.append(frame)
        if len(frames) >= limit:
            break
    return frames


def test_an_event_is_framed_with_its_sequence_as_the_id() -> None:
    frame = format_event(RunEvent(seq=3, kind="node_started", payload={"node": "survey"}))
    assert frame == 'id: 3\nevent: node_started\ndata: {"node":"survey"}\n\n'


@pytest.mark.parametrize(
    ("header", "cursor"),
    [
        (None, 0),
        ("", 0),
        ("7", 7),
        (" 7 ", 7),
        ("-1", 0),
        ("abc", 0),
        ("1.5", 0),
        # `str.isdigit` accepts these, and `int` refuses them.
        ("²", 0),
        ("٣", 0),
        ("9" * 5000, 0),
    ],
)
def test_a_cursor_that_is_not_a_sequence_number_replays_from_the_start(
    header: str | None, cursor: int
) -> None:
    assert parse_cursor(header) == cursor


def test_a_stream_closes_before_the_token_expires_or_at_its_maximum_length() -> None:
    now = 1_000_000.0
    assert closes_at(now + 60, now=now) == now + 60 - TOKEN_MARGIN_SECONDS
    assert closes_at(now + 86_400, now=now) == now + MAX_STREAM_SECONDS


async def test_a_stream_tails_new_events_and_closes_on_the_terminal_one() -> None:
    log = await started_log()
    stream = follow(log.reader_for(OWNER), RUN, after=0, until=FAR_FUTURE, poll_seconds=0.01)

    async def finish_later() -> None:
        await asyncio.sleep(0.05)
        await log.record(RUN, "node_started", {"node": "load_project"})
        await log.record(RUN, "succeeded", {"run_id": RUN})

    finisher = asyncio.create_task(finish_later())
    frames = await asyncio.wait_for(collect(stream), timeout=2)
    await finisher

    kinds = [frame.split("\n")[1] for frame in frames if frame.startswith("id:")]
    assert kinds == ["event: started", "event: node_started", "event: succeeded"]


async def test_a_quiet_stream_sends_heartbeats() -> None:
    log = await started_log()
    stream = follow(
        log.reader_for(OWNER),
        RUN,
        after=1,
        until=time.time() + 0.1,
        poll_seconds=0.01,
        heartbeat_seconds=0.02,
    )

    frames = await asyncio.wait_for(collect(stream), timeout=2)

    assert frames[0].startswith("retry: ")
    assert ": keepalive\n\n" in frames


async def test_a_stream_reaching_its_deadline_closes_without_an_event() -> None:
    """The client reconnects from its cursor, so closing early loses nothing."""
    log = await started_log()
    stream = follow(log.reader_for(OWNER), RUN, after=1, until=time.time(), poll_seconds=0.01)

    frames = await asyncio.wait_for(collect(stream), timeout=2)

    assert not any(frame.startswith("id:") for frame in frames)
