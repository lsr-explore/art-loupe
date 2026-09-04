"""What a deterministic tool returns alongside its artifact (FR-305).

"Every tool returns an artifact **plus machine-readable metadata**: tool name and version,
validated parameters, source checksum, duration, confidence, and stated limitations. Agents
cite the metadata; they never describe an artifact from memory."

That last clause is why this type exists rather than a loose dict. An agent describing a
plate it did not read is the failure mode the whole measured/cited/chosen taxonomy is built
to prevent, and it starts with metadata being optional.

Slice 1 keeps no derivative pixels: the artifact is reproducible from
`(source_checksum, tool, tool_version, parameters)`, so the recipe is stored and the plate is
regenerated rather than persisted.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from artloupe.schemas.evidence import Checksum
from artloupe.schemas.manifest import ToolName


class ArtifactMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool: ToolName
    tool_version: str = Field(min_length=1)
    # What the tool ran with after validation, not what it was asked for.
    parameters: dict[str, Any]
    source_checksum: Checksum
    duration_ms: int = Field(ge=0)
    # Per-artifact confidence, `None` where the notion is meaningless.
    #
    # A grayscale conversion has no confidence — it either ran or it did not. A vanishing
    # point does, and below threshold it is what raises the interrupt (FR-401/402) rather
    # than being asserted with a caveat. `None` and `0.0` are different claims; do not
    # collapse them to a default — and note there is deliberately no default at all, so a
    # tool that forgets to state its confidence fails validation rather than reporting None.
    confidence: float | None = Field(ge=0.0, le=1.0)
    # What this artifact does not show. Empty is a claim, not an omission.
    limitations: list[str]
