"""One row per node execution — the unit the operations dashboard aggregates.

The shape is fixed here rather than discovered later because it is durable: it is written to
`public.run_node_metrics` and read by FR-905 long after the run ended. Fields exist for
reasons that are not all obvious:

- `run_id` is the NFR-09 identifier, the same value the studio shows the artist and the same
  value the checkpointer threads a resumed run onto. It is what makes an operations row
  correspond to something someone actually saw.
- `owner` is the Supabase subject from the verified token. It is stored so the row can be
  scoped by owner once `runs` exists (PR 13); until then this table's row policy denies
  every API role outright.
- `attempt` counts executions of *this node in this run*. It is not decoration. On resume,
  LangGraph re-runs the whole node containing `interrupt()` from the top, so a second row for
  the same node is expected and correct — and a ledger that silently merged the two would
  hide the double charge that hazard causes.
- Cache tokens stay separate from `input_tokens` because they are billed at different rates.
  The budget ledger adds them together, because a ceiling on "input tokens" that ignored
  cached ones would not be a ceiling; cost keeps them apart, because a cost that ignored the
  rates would be wrong. Both are true at once, which is why the split lives here.
- `cost_usd` is nullable. `None` means the model was not in the price table — unpriced, not
  free. See `pricing.estimate_cost_usd`.
"""

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# What a node run ended as. `guard_stopped` is separated from `error` deliberately: a run cut
# off by its own ceiling is the system working, and folding it into the error rate would make
# a correctly enforced budget look like a fault.
NodeStatus = Literal["ok", "error", "guard_stopped"]


class NodeMetric(BaseModel):
    """What one execution of one node spent."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)
    owner: str = Field(min_length=1)
    node: str = Field(min_length=1)
    attempt: int = Field(ge=1)
    started_at: datetime
    duration_ms: int = Field(ge=0)
    status: NodeStatus
    # `None` for a deterministic node, which is most of slice 1.
    model: str | None = None
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    cache_read_tokens: int = Field(default=0, ge=0)
    cache_write_tokens: int = Field(default=0, ge=0)
    # Deterministic image-tool invocations, not provider image generation (FR-801).
    tool_calls: int = Field(default=0, ge=0)
    cost_usd: Decimal | None = None
    error: str | None = None

    @property
    def total_tokens(self) -> int:
        """Every token this node was billed for, cached ones included.

        This is what the NFR-04 ceiling counts. Excluding cache reads would let a run that
        reads a large cached prefix on every hop stay under a ceiling it has plainly passed.
        """
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_read_tokens
            + self.cache_write_tokens
        )
