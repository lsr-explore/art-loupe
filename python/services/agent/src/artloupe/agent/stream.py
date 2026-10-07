"""Following a run's log over Server-Sent Events.

The stream is a view of `run_events`, never a source of its own. It replays every event after
the client's cursor, then tails the log until the run finishes. A browser's `EventSource`
reconnects by itself and sends the last id it saw as `Last-Event-ID`, so a reload or a dropped
connection resumes where it stopped and loses nothing. Any process can serve any run's stream,
because nothing about a run lives in one process's memory.

Three things bound a stream:

- **A terminal event.** After `succeeded` or `failed` there is nothing more to say.
- **The artist's token.** The log is read as the artist, so the stream closes shortly before the
  token expires. The client reconnects through the studio, which refreshes the token first.
- **A maximum length**, so a stream nobody closes cannot be held open indefinitely. The client
  reconnects from its cursor, which costs it nothing.

Tailing polls the cursor (`seq > after`). At walking-skeleton scale that is a few small indexed
reads a second per open stream. `LISTEN/NOTIFY` can replace the polling later without changing
anything a client sees.
"""

import asyncio
import json
import time
from collections.abc import AsyncIterator

from artloupe.persistence import TERMINAL_KINDS, RunEvent, RunReader

POLL_SECONDS = 0.5

# Proxies close a connection that has been silent for a while. An SSE comment line keeps it open
# and is ignored by the client.
HEARTBEAT_SECONDS = 15.0

# How long before the token's expiry the stream closes, so the last read is never refused.
TOKEN_MARGIN_SECONDS = 30.0

MAX_STREAM_SECONDS = 300.0

# Sent first: how long `EventSource` waits before reconnecting, in milliseconds.
RETRY_MILLISECONDS = 1000


def format_event(event: RunEvent) -> str:
    """One event in SSE framing. The id is the cursor a reconnecting client sends back."""
    data = json.dumps(event.payload, separators=(",", ":"))
    return f"id: {event.seq}\nevent: {event.kind}\ndata: {data}\n\n"


def parse_cursor(last_event_id: str | None) -> int:
    """The `Last-Event-ID` a client sent, as a sequence number.

    Anything that is not a non-negative integer replays from the start. That is always safe: the
    log is append-only, so a replay shows the artist nothing that did not happen.
    """
    if last_event_id is None or not last_event_id.strip().isdigit():
        return 0
    return int(last_event_id.strip())


def closes_at(token_expires_at: float, *, now: float | None = None) -> float:
    """When a stream opened now must close, as a Unix time."""
    current = time.time() if now is None else now
    return min(token_expires_at - TOKEN_MARGIN_SECONDS, current + MAX_STREAM_SECONDS)


async def follow(
    reader: RunReader,
    run_id: str,
    *,
    after: int,
    until: float,
    poll_seconds: float = POLL_SECONDS,
    heartbeat_seconds: float = HEARTBEAT_SECONDS,
) -> AsyncIterator[str]:
    """Yield the run's events after `after`, then new ones as they land, until it finishes.

    `until` is a Unix time. Reaching it closes the stream without an event, and the client
    reconnects from its cursor.
    """
    yield f"retry: {RETRY_MILLISECONDS}\n\n"
    cursor = after
    last_sent = time.monotonic()
    while True:
        events = await reader.run_events_after(run_id, cursor)
        for event in events:
            yield format_event(event)
            cursor = event.seq
            if event.kind in TERMINAL_KINDS:
                return
        if events:
            last_sent = time.monotonic()
        elif time.monotonic() - last_sent >= heartbeat_seconds:
            yield ": keepalive\n\n"
            last_sent = time.monotonic()

        if time.time() >= until:
            return
        await asyncio.sleep(poll_seconds)
