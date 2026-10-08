"""The run log: one row per run, and the append-only events the studio streams.

A run is a background job (`docs/decision-records/poc-design-notes.md`). The agent records it,
returns at once, and appends an event at each step. The studio follows the events over SSE and
replays them after a reload, so the log, not any process's memory, is what a run has done.

Writing and reading are deliberately two different credentials:

- **Writes** go through `PostgresRunLog`, which narrows its connection to the
  `artloupe_run_recorder` role. That role may execute `artloupe_run_create` and
  `artloupe_run_record` and nothing else, and those functions refuse every illegal transition.
  The artist's token cannot write run state at all, so an artist cannot forge their own run's
  status or result through PostgREST.
- **Reads** go through `ArtistApi`, as the artist, so RLS decides whose runs are visible.

`InMemoryRunLog` is both halves in one process, for tests and for a service run without a
database. It enforces the same transitions as the SQL functions, so a test against it fails
where the database would.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Protocol

from psycopg.types.json import Jsonb

from artloupe.persistence.artist_api import ProjectNotFound
from artloupe.persistence.config import get_settings
from artloupe.persistence.run_events import RunEvent, RunEventKind

RECORDER_ROLE = "artloupe_run_recorder"

# Every recorder call is bounded, end to end. A stalled database must not hold a run open past its
# deadline, or hold shutdown open in `cancel_pending_runs`.
RECORDER_TIMEOUT_SECONDS = 5.0


class RunTransitionRefused(RuntimeError):
    """The log refused an event the run's current status does not allow."""


class RunLog(Protocol):
    """Where a run is recorded. Written by the agent, never by the artist."""

    async def create(self, *, run_id: str, project_id: str, owner: str) -> None:
        """Record a queued run, or raise `ProjectNotFound` if the project is not the owner's."""
        ...

    async def record(
        self, run_id: str, kind: RunEventKind, payload: Mapping[str, Any] | None = None
    ) -> int:
        """Append one event and return its sequence number."""
        ...


class RunReader(Protocol):
    """What one artist can see of their runs."""

    async def run_visible(self, run_id: str) -> bool: ...

    async def run_events_after(self, run_id: str, after: int) -> list[RunEvent]: ...


# ---------------------------------------------------------------------------------------------
# In memory
# ---------------------------------------------------------------------------------------------


@dataclass
class _MemoryRun:
    owner: str
    project_id: str
    status: str = "queued"
    events: list[RunEvent] = field(default_factory=list)


def _check_transition(status: str, kind: str) -> str:
    """The next status, or `RunTransitionRefused`. Mirrors `artloupe_run_record`."""
    if status in ("succeeded", "failed"):
        raise RunTransitionRefused(f"the run is {status} and cannot change")
    if kind == "started" and status != "queued":
        raise RunTransitionRefused(f"cannot record started while {status}")
    if kind in ("node_started", "node_finished", "succeeded") and status != "running":
        raise RunTransitionRefused(f"cannot record {kind} while {status}")
    return {"started": "running", "succeeded": "succeeded", "failed": "failed"}.get(kind, status)


class InMemoryRunLog:
    """Runs kept in the process. Correct for tests; a restart forgets every run."""

    def __init__(self) -> None:
        self.runs: dict[str, _MemoryRun] = {}
        self._lock = asyncio.Lock()

    async def create(self, *, run_id: str, project_id: str, owner: str) -> None:
        async with self._lock:
            self.runs[run_id] = _MemoryRun(owner=owner, project_id=project_id)

    async def record(
        self, run_id: str, kind: RunEventKind, payload: Mapping[str, Any] | None = None
    ) -> int:
        async with self._lock:
            run = self.runs.get(run_id)
            if run is None:
                raise RunTransitionRefused(f"no run {run_id}")
            run.status = _check_transition(run.status, kind)
            event = RunEvent(seq=len(run.events) + 1, kind=kind, payload=dict(payload or {}))
            run.events.append(event)
            return event.seq

    def reader_for(self, owner: str) -> InMemoryRunReader:
        """What `owner` can see, as RLS would scope it."""
        return InMemoryRunReader(self, owner)


@dataclass(frozen=True)
class InMemoryRunReader:
    log: InMemoryRunLog
    owner: str

    def _run(self, run_id: str) -> _MemoryRun | None:
        run = self.log.runs.get(run_id)
        return run if run is not None and run.owner == self.owner else None

    async def run_visible(self, run_id: str) -> bool:
        return self._run(run_id) is not None

    async def run_events_after(self, run_id: str, after: int) -> list[RunEvent]:
        run = self._run(run_id)
        return [] if run is None else [event for event in run.events if event.seq > after]


# ---------------------------------------------------------------------------------------------
# Postgres
# ---------------------------------------------------------------------------------------------


class PostgresRunLog:
    """Writes runs through the recorder functions, as `artloupe_run_recorder`.

    One connection per call, no pool, matching `PostgresMetricsSink`. A run records about a dozen
    events, so this is a dozen short connections per run. That is fine for the walking skeleton
    and is the first thing to pool once runs are frequent.
    """

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def _call(
        self, statement: str, params: tuple[Any, ...], *, missing: Callable[[], Exception]
    ) -> Any:
        """Run one recorder function. `missing` is what its `no_data_found` means to a caller."""
        async with asyncio.timeout(RECORDER_TIMEOUT_SECONDS):
            return await self._call_unbounded(statement, params, missing=missing)

    async def _call_unbounded(
        self, statement: str, params: tuple[Any, ...], *, missing: Callable[[], Exception]
    ) -> Any:
        from psycopg import AsyncConnection, errors

        # `statement_timeout` bounds the query on the server too, so a timed-out call does not
        # leave a statement running there after the client has given up on it.
        timeout_ms = int(RECORDER_TIMEOUT_SECONDS * 1000)
        async with await AsyncConnection.connect(
            self._database_url,
            connect_timeout=int(RECORDER_TIMEOUT_SECONDS),
            options=f"-c statement_timeout={timeout_ms}",
        ) as conn:
            try:
                # Transaction-scoped, so the narrowing cannot outlive this call.
                await conn.execute(f"set local role {RECORDER_ROLE}")
                cursor = await conn.execute(statement, params)
                row = await cursor.fetchone()
            except errors.NoDataFound as error:
                await conn.rollback()
                raise missing() from error
            except errors.RestrictViolation as error:
                await conn.rollback()
                raise RunTransitionRefused(str(error.diag.message_primary)) from error
            await conn.commit()
            return row[0] if row else None

    async def create(self, *, run_id: str, project_id: str, owner: str) -> None:
        # An absent project and another artist's are one answer, as they are under RLS.
        await self._call(
            "select public.artloupe_run_create(%s, %s, %s)",
            (run_id, project_id, owner),
            missing=lambda: ProjectNotFound("no project with this id belongs to this artist"),
        )

    async def record(
        self, run_id: str, kind: RunEventKind, payload: Mapping[str, Any] | None = None
    ) -> int:
        seq = await self._call(
            "select public.artloupe_run_record(%s, %s, %s)",
            (run_id, kind, Jsonb(dict(payload or {}))),
            missing=lambda: RunTransitionRefused(f"no run {run_id}"),
        )
        return int(seq)


@lru_cache(maxsize=1)
def get_run_log() -> RunLog:
    """The configured run log, one per process.

    In memory unless `ARTLOUPE_RUN_LOG=postgres`. One instance, so that the in-memory log the
    background run writes is the same one the stream reads.
    """
    settings = get_settings()
    if settings.artloupe_run_log == "postgres":
        return PostgresRunLog(settings.run_log_database_url())
    return InMemoryRunLog()
