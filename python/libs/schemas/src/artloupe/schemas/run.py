"""How a run ended, as its final event carries it.

A run is a background job (`docs/decision-records/poc-design-notes.md`), so its outcome is not an
HTTP response. It is the payload of the run's last event: a `RunResult` on `succeeded`, a
`RunFailure` on `failed`. The studio validates both before rendering anything, so these are
mirrored field for field by `packages/schemas/src/run.ts`.

`reason` is a closed vocabulary because the studio localizes it. `detail` is English, safe to
show, and never carries an upstream error body.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from artloupe.schemas.artifact import ArtifactMetadata
from artloupe.schemas.plan import PlanOutcome
from artloupe.schemas.routing import RoutingDecision

RunFailureReason = Literal[
    "budget_exceeded",
    "deadline_exceeded",
    "guard_stopped",
    "project_not_found",
    "project_not_ready",
    "photograph_unavailable",
    "credential_rejected",
    "data_service_refused",
    "routing_failed",
    "analysis_failed",
    "planning_failed",
    "critique_failed",
    "interrupted",
    "internal_error",
]

RUN_FAILURE_REASONS: tuple[RunFailureReason, ...] = RunFailureReason.__args__  # type: ignore[attr-defined]


class RunResult(BaseModel):
    """What a finished run produced. The `succeeded` event's payload."""

    model_config = ConfigDict(extra="forbid")

    run_id: str
    owner: str
    project_id: str
    node_trail: list[str]
    # The face gate's figures. Open-ended on purpose: the gate reports what it measured, and the
    # studio renders the routing decision, which already carries the gate's outcome.
    gate: dict[str, Any]
    routing: RoutingDecision
    artifacts: list[ArtifactMetadata]
    # The findings, lessons, plan and verdicts. `None` only on a run recorded before the plan half
    # of the graph existed: its `succeeded` event is replayed as stored, so the field must be
    # optional for those events to keep validating.
    plan: PlanOutcome | None = None


class RunFailure(BaseModel):
    """Why a run stopped. The `failed` event's payload."""

    model_config = ConfigDict(extra="forbid")

    reason: RunFailureReason
    detail: str
