"""Running a run as a background job, and recording how it ended.

`POST /runs` records a queued run and returns at once. The run itself happens here, after the
response has gone, and everything the artist learns about it arrives through the run log: a
`started` event, a start and finish for each node, then exactly one `succeeded` or `failed`.

**`dispatch_run` is the seam the NFR-02 worker pool replaces.** Today it starts an in-process
task, which is enough for the walking skeleton and is not durable: a restart loses the run, and a
deployed Cloud Run instance may throttle a task once its response is sent (unverified; see
`docs/decision-records/poc-design-notes.md`). A queued worker changes only that function.

**A stopped run is a `failed` event, never a raised error.** There is no response left to carry
one. So each way a run can stop is translated here into a machine-readable `reason` the studio
can localize, and a `detail` that is safe to show the artist. The translation keeps the
distinctions the synchronous handlers drew: a budget working as designed is not a fault, and a
missing project is not either.
"""

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

from artloupe.agent.director import RoutingFailed
from artloupe.agent.nodes import ProjectNotReady
from artloupe.agent.resources import PhotographUnavailable, RunResources
from artloupe.agent.runtime import execute_run
from artloupe.agent.state import RunState
from artloupe.metering import BudgetExceeded, GuardTripped, RunGuards, WallClockExceeded
from artloupe.persistence import (
    ArtistApiError,
    CredentialRejected,
    ProjectNotFound,
    RunEventKind,
    RunLog,
    RunTransitionRefused,
)
from artloupe.schemas import ArtifactMetadata, RoutingDecision, RunFailure, RunResult

logger = logging.getLogger(__name__)


INTERNAL_FAILURE = RunFailure(
    reason="internal_error", detail="The run stopped because of an internal error."
)


def describe_failure(error: BaseException) -> RunFailure:
    """The reason and the artist-safe detail for whatever stopped a run.

    Order matters where one class extends another: `CredentialRejected` is an `ArtistApiError`,
    and `WallClockExceeded` and `BudgetExceeded` are `GuardTripped`.
    """
    match error:
        case BudgetExceeded():
            return RunFailure(reason="budget_exceeded", detail=error.reason)
        case WallClockExceeded():
            return RunFailure(reason="deadline_exceeded", detail=error.reason)
        case GuardTripped():
            # A graph that will not converge is our bug, but its reason is still ours to show.
            return RunFailure(reason="guard_stopped", detail=error.reason)
        case ProjectNotFound():
            # One answer for absent and somebody else's, as everywhere else.
            return RunFailure(reason="project_not_found", detail="Project not found.")
        case ProjectNotReady():
            return RunFailure(reason="project_not_ready", detail=str(error))
        case PhotographUnavailable():
            return RunFailure(reason="photograph_unavailable", detail=str(error))
        case CredentialRejected():
            return RunFailure(
                reason="credential_rejected",
                detail="Supabase rejected the access token during the run. Refresh it and retry.",
            )
        case ArtistApiError():
            # The upstream detail is not forwarded: a PostgREST error can quote a policy.
            return RunFailure(
                reason="data_service_refused", detail="The data service refused a call."
            )
        case RoutingFailed():
            return RunFailure(reason="routing_failed", detail=str(error))
        case _:
            return INTERNAL_FAILURE


def progress_reporter(log: RunLog, run_id: str):
    """The `RunResources.progress` callable for one run."""

    async def report(kind: RunEventKind, payload: dict[str, str]) -> None:
        await log.record(run_id, kind, payload)

    return report


async def run_job(
    graph: Any,
    initial: RunState,
    *,
    log: RunLog,
    guards: RunGuards,
    resources: RunResources,
) -> None:
    """Execute one recorded run to its end, and record that end. Never raises, except to cancel."""
    run_id = initial["run_id"]
    try:
        await log.record(run_id, "started")
        resources.progress = progress_reporter(log, run_id)
        outcome = await execute_run(
            graph,
            dict(initial),
            run_id=run_id,
            owner=initial["owner"],
            guards=guards,
            resources=resources,
        )
        state = outcome.state
        result = RunResult(
            run_id=state["run_id"],
            owner=state["owner"],
            project_id=state["project_id"],
            node_trail=state["node_trail"],
            gate=state["gate"],
            routing=RoutingDecision.model_validate(state["routing"]),
            artifacts=[ArtifactMetadata.model_validate(entry) for entry in state["artifacts"]],
        )
        await record_terminal(log, run_id, "succeeded", result.model_dump(mode="json"))
    except asyncio.CancelledError:
        await _record_failure(
            log,
            run_id,
            RunFailure(
                reason="interrupted", detail="The service stopped before the run could finish."
            ),
        )
        raise
    except Exception as error:
        failure = describe_failure(error)
        if failure is INTERNAL_FAILURE:
            logger.exception("run failed", extra={"run_id": run_id})
        await _record_failure(log, run_id, failure)


# Delays before each retry of a run's final event. Short, because the artist is watching.
TERMINAL_RETRY_DELAYS = (0.5, 1.0, 2.0)


async def record_terminal(
    log: RunLog, run_id: str, kind: RunEventKind, payload: dict[str, Any]
) -> None:
    """Record a run's final event, retrying a transient failure.

    The final event is the one write a run cannot lose: without it the run stays `running` and
    its followers never learn how it ended. A refused transition is not retried. It means the
    run already finished, which is what a retry after a lost commit acknowledgement sees.

    A run whose final write fails every attempt is still stranded. Recovering those belongs to
    the NFR-02 worker pool, which knows which runs it owns.
    """
    for delay in (*TERMINAL_RETRY_DELAYS, None):
        try:
            await log.record(run_id, kind, payload)
            return
        except RunTransitionRefused:
            return
        except Exception:
            if delay is None:
                raise
            logger.warning("retrying a run's final event", extra={"run_id": run_id, "kind": kind})
            await asyncio.sleep(delay)


async def _record_failure(log: RunLog, run_id: str, failure: RunFailure) -> None:
    """Record the end of a run that stopped. If even that fails, the log is all that is left."""
    try:
        await record_terminal(log, run_id, "failed", failure.model_dump())
    except Exception:
        logger.exception(
            "failed to record a run's failure", extra={"run_id": run_id, "reason": failure.reason}
        )


# Held so a running task is not garbage-collected: asyncio keeps only a weak reference to it.
_PENDING: set[asyncio.Task[None]] = set()


def dispatch_run(job: Coroutine[Any, Any, None]) -> None:
    """Start `job` without waiting for it. The seam the NFR-02 worker pool replaces."""
    task = asyncio.create_task(job)
    _PENDING.add(task)
    task.add_done_callback(_PENDING.discard)


async def cancel_pending_runs() -> None:
    """On shutdown, stop every run still going. Each records itself as `interrupted`."""
    tasks = list(_PENDING)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
