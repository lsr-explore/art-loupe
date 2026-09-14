"""The Studio Director's routing decision, as the studio will render it (routing-plan §3).

Three parts, and only one of them is the model's:

- `manifest` is what runs, and what was declined and why (FR-307). It is the existing
  `ToolManifest`, unchanged.
- `rationale` is the routing summary the walkthrough's beat 4 renders: "the tool manifest and its
  routing rationale."
- `gate` is the face gate's deterministic outcome. It travels beside the manifest so a reader can
  tell the gate's half of the decision from the model's.

Completeness, meaning every offered tool named exactly once, is deliberately *not* checked here.
It is judged against the tools a producer was offered, which this contract cannot know. A check
against today's `TOOLS` would also stop every stored decision from reloading the day `TOOLS` grows
(routing-plan §10, question 2). `check_accounts_for` is the producer's check.
"""

from pydantic import BaseModel, ConfigDict, Field, model_validator

from artloupe.schemas.manifest import ToolManifest


class RoutingGate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    face_found: bool
    # The gate's own reason, present exactly when it declined head construction.
    reason: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _reason_matches_outcome(self) -> "RoutingGate":
        if not self.face_found and self.reason is None:
            raise ValueError("a gate that found no face must say why")
        if self.face_found and self.reason is not None:
            raise ValueError("a gate that found a face declined nothing, so it has no reason")
        return self


class RoutingDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manifest: ToolManifest
    rationale: str = Field(min_length=1)
    gate: RoutingGate

    @model_validator(mode="after")
    def _no_face_no_head_construction(self) -> "RoutingDecision":
        """The gate's half of FR-307 binds every producer, a model or anything else."""
        if not self.gate.face_found and any(
            entry.tool == "head_construction" for entry in self.manifest.selected
        ):
            raise ValueError("head_construction cannot be selected when the gate found no face")
        return self
