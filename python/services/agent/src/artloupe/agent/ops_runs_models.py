"""Run health and one run's drill-down (FR-901). Mirrored by `@artloupe/schemas/ops-runs`.

Built from `runs` and `run_events`, read as `artloupe_ops_reader`, which cannot see a run's
`result` or its owner. Nothing here carries either.
"""

from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from artloupe.agent.ops_cost_models import CostWindow, NodeCost

RunStatus = Literal["queued", "running", "succeeded", "failed"]
RunEventKind = Literal["started", "node_started", "node_finished", "succeeded", "failed"]

# The most runs either list in the report carries. `run_count` and the status counts are whole.
RUN_LIST_LIMIT = 50


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StatusCounts(_Strict):
    queued: int = Field(ge=0)
    running: int = Field(ge=0)
    succeeded: int = Field(ge=0)
    failed: int = Field(ge=0)


class DurationStats(_Strict):
    """Percentiles over the runs that have both ends of the interval. Null when none do."""

    runs: int = Field(ge=0)
    p50_ms: int | None = Field(ge=0)
    p95_ms: int | None = Field(ge=0)


class FailureGroup(_Strict):
    reason: str
    # The node that was running when the run stopped. Null when it stopped between nodes.
    failed_node: str | None
    runs: int = Field(ge=1)


class RunLedger(_Strict):
    """What the run's ledger rows say it cost. Unpriced rows are counted, never summed as zero."""

    node_executions: int = Field(ge=0)
    priced_cost_usd: Decimal = Field(ge=0)
    unpriced_rows: int = Field(ge=0)


class RunSummary(_Strict):
    run_id: UUID
    project_id: UUID
    status: RunStatus
    # Queued or running for longer than the agent's own deadline allows.
    stalled: bool
    reason: str | None
    failed_node: str | None
    created_at: AwareDatetime
    started_at: AwareDatetime | None
    finished_at: AwareDatetime | None
    # Null until the run ends: the ledger is flushed once, when a run finishes.
    cost: RunLedger | None


class RunHealthReport(_Strict):
    window: CostWindow
    since: AwareDatetime
    generated_at: AwareDatetime
    stall_after_seconds: int = Field(ge=1)
    run_count: int = Field(ge=0)
    status_counts: StatusCounts
    queue_wait: DurationStats
    run_time: DurationStats
    failures: list[FailureGroup]
    # Every stalled run, whatever the window. `stalled` lists at most RUN_LIST_LIMIT of them.
    stalled_count: int = Field(ge=0)
    # Not limited to the window: a run stuck since last week still matters. Oldest first.
    stalled: list[RunSummary] = Field(max_length=RUN_LIST_LIMIT)
    # Newest first.
    recent_runs: list[RunSummary] = Field(max_length=RUN_LIST_LIMIT)


class RunEvent(_Strict):
    seq: int = Field(ge=1)
    kind: RunEventKind
    node: str | None
    reason: str | None
    created_at: AwareDatetime
    # Time since the run was created, so a timeline reads without date arithmetic.
    offset_ms: int = Field(ge=0)


class NodeStep(_Strict):
    """One node's execution, paired from its start and finish events by node name.

    Progress events are best-effort, so either end can be missing. A start with no finish is
    the node that was running when the run stopped, or one whose finish was lost; a finish with
    no start is one whose start was lost.
    """

    node: str
    started_at: AwareDatetime | None
    # Null for a node that never finished: the one that was running when the run stopped.
    finished_at: AwareDatetime | None
    duration_ms: int | None = Field(ge=0)


class RunDetail(_Strict):
    run: RunSummary
    # The artist-safe detail the failure recorded, which the studio also shows.
    error_detail: str | None
    events: list[RunEvent]
    steps: list[NodeStep]
    # Per-node ledger rows for this run; `reexecutions` is where retries show.
    ledger: list[NodeCost]
