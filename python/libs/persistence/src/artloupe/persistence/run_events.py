"""The shape of one run event, shared by the writer and the artist-scoped reader."""

from dataclasses import dataclass
from typing import Any, Literal

RunEventKind = Literal["started", "node_started", "node_finished", "succeeded", "failed"]

# A run that has recorded one of these is finished, and the stream that follows it can close.
TERMINAL_KINDS: frozenset[str] = frozenset({"succeeded", "failed"})


@dataclass(frozen=True)
class RunEvent:
    """One step of a run. `seq` is 1-based and gapless, and is the SSE event id."""

    seq: int
    kind: RunEventKind
    payload: dict[str, Any]
