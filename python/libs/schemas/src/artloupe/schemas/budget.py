"""The per-project plan budget (NFR-04): a token ceiling with a hard stop, visible in
operations.

`agents.md` §3 sketches this as "tokens, image calls, cache hits, hard stop". The middle
term is recorded here as `tool_calls`, meaning invocations of the deterministic image tools —
with no provider image endpoint reachable from any node (FR-801), there are no image
*generation* calls left to meter.

Two ledgers exist in the finished design and neither can stop the other: this one covers plan
generation, and chat credits are separate (NFR-11). Only this one is in slice 1.

One resume hazard worth knowing before anything increments a counter here: on resume,
LangGraph re-runs the *whole node* containing `interrupt()` from the top. Any metering that
happens before the interrupt call is therefore charged twice. Keep `interrupt()` alone in a
node that does nothing else.
"""

from pydantic import BaseModel, ConfigDict, Field, model_validator


class BudgetLedger(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    # Deterministic image-tool invocations, not provider image generation (FR-801).
    tool_calls: int = Field(default=0, ge=0)
    cache_hits: int = Field(default=0, ge=0)
    token_ceiling: int = Field(gt=0)
    stopped: bool = False
    # Required whenever `stopped` — a hard stop with no reason is unreviewable.
    stop_reason: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _stopped_ledger_states_why(self) -> "BudgetLedger":
        if self.stopped and self.stop_reason is None:
            raise ValueError("a stopped ledger must carry a stop_reason")
        return self
