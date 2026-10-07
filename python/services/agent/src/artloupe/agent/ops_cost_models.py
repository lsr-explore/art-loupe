"""The cost report the operations dashboard renders. Mirrored by `@artloupe/schemas/ops-cost`.

Cost is split in two on every grouping, because a null `cost_usd` means unpriced, not free.
`priced_cost_usd` sums only the rows that carry a price, and `unpriced_rows` counts the rest.
A total with any unpriced row is a lower bound, and the panel says so rather than showing it
as a complete figure.
"""

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CostWindow = Literal["24h", "7d", "30d"]

# The number of most recent runs the report lists. `run_count` carries the full figure.
RECENT_RUNS_LIMIT = 50


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CostTotals(_Strict):
    """What one grouping spent. Every grouping in the report carries the same fields."""

    node_executions: int = Field(ge=0)
    # Executions with `attempt > 1`. A resumed run re-executes the node holding `interrupt()`,
    # and this is the only place that second charge is visible.
    reexecutions: int = Field(ge=0)
    priced_cost_usd: Decimal = Field(ge=0)
    unpriced_rows: int = Field(ge=0)
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    cache_read_tokens: int = Field(ge=0)
    cache_write_tokens: int = Field(ge=0)
    duration_ms: int = Field(ge=0)


class ModelCost(CostTotals):
    # Null for deterministic nodes, which call no model.
    model: str | None


class NodeCost(CostTotals):
    node: str


class RunCost(CostTotals):
    run_id: str
    started_at: datetime


class CostReport(_Strict):
    window: CostWindow
    since: datetime
    generated_at: datetime
    run_count: int = Field(ge=0)
    totals: CostTotals
    by_model: list[ModelCost]
    by_node: list[NodeCost]
    # The most recent runs first, at most RECENT_RUNS_LIMIT of them.
    recent_runs: list[RunCost] = Field(max_length=RECENT_RUNS_LIMIT)
