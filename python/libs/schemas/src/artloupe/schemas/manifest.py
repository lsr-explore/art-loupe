"""What the Studio Director decided to run, and what it decided not to (FR-307).

The declination half is the load-bearing one. "Tool selection is a decision, not a fixture.
A run must be able to decline a tool and say why — a portrait run declines perspective, and
that refusal is visible." A manifest that could only ever list what ran would make the
Director a lookup table, so `reason` is required on every declination and optional on every
selection.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Tools the graph can select in slice 1.
#
# The three plates share one pipeline — `three_value` posterises, and `outline` traces the
# boundaries between those value regions rather than raw gradients, which is why the two
# always correspond and why the outline carries no texture speckle.
ToolName = Literal[
    "grayscale",
    "three_value",
    "outline",
    "head_construction",
    "perspective",
]

TOOLS: tuple[str, ...] = (
    "grayscale",
    "three_value",
    "outline",
    "head_construction",
    "perspective",
)


class ToolSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool: ToolName
    # Optional: a selection explains itself less often than a refusal needs to.
    reason: str | None = Field(default=None, min_length=1)


class ToolDeclination(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool: ToolName
    # Required by FR-307 — a silent decline is indistinguishable from a bug.
    reason: str = Field(min_length=1)


class ToolManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selected: list[ToolSelection]
    declined: list[ToolDeclination]

    @model_validator(mode="after")
    def _no_tool_is_both(self) -> "ToolManifest":
        selected_tools = {entry.tool for entry in self.selected}
        overlap = sorted(entry.tool for entry in self.declined if entry.tool in selected_tools)
        if overlap:
            raise ValueError(f"a tool cannot be both selected and declined: {', '.join(overlap)}")
        return self
