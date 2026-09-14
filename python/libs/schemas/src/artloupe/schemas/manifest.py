"""What the Studio Director decided to run, and what it decided not to (FR-307).

The declination half is the load-bearing one. "Tool selection is a decision, not a fixture.
A run must be able to decline a tool and say why — a portrait run declines perspective, and
that refusal is visible." A manifest that could only ever list what ran would make the
Director a lookup table, so `reason` is required on every declination and optional on every
selection.
"""

from collections.abc import Iterable
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Tools the graph can select in slice 1.
#
# The four plates share one pipeline. `value_map` posterises into two to ten values;
# `value_shapes` traces the boundaries between those value regions, so it always corresponds to
# the map and finds a boundary wherever the histogram has a gap, however shallow; `outline`
# traces edges in a texture-flattened copy and fits straight runs as straight lines, so it is
# clean where `value_shapes` wanders and blind where the photograph has no gradient to give.
# They are selected separately because a run can want one and not the other.
ToolName = Literal[
    "grayscale",
    "value_map",
    "value_shapes",
    "outline",
    "head_construction",
    "perspective",
]

TOOLS: tuple[str, ...] = (
    "grayscale",
    "value_map",
    "value_shapes",
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


class IncompleteManifest(ValueError):
    """A manifest that does not name every offered tool exactly once (FR-307)."""


def check_accounts_for(manifest: ToolManifest, offered: Iterable[str]) -> None:
    """Refuse a manifest that leaves an offered tool out, names one twice, or names one not offered.

    The producer's check, not the contract's (routing-plan §10, question 2). It is judged against
    what the producer was actually offered, so a manifest stored today still reloads after `TOOLS`
    grows. Every producer applies it at the moment it produces: the Director now, and re-routing
    and chat re-routing later. An omitted tool is a silent declination, which FR-307 forbids.

    Every problem is reported together, so one bad answer is one error rather than several.
    """
    offered_tools = set(offered)
    named = [entry.tool for entry in (*manifest.selected, *manifest.declined)]

    problems = []
    if missing := sorted(offered_tools - set(named)):
        problems.append(f"not accounted for: {', '.join(missing)}")
    if repeated := sorted({tool for tool in named if named.count(tool) > 1}):
        problems.append(f"named more than once: {', '.join(repeated)}")
    if unoffered := sorted(set(named) - offered_tools):
        problems.append(f"not offered: {', '.join(unoffered)}")
    if problems:
        raise IncompleteManifest("; ".join(problems))
