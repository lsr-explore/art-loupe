"""What the Visual Analyst, the lesson source, the Studio Planner and the Plan Critic hand on.

`docs/design/agents.md` §3-4 sketches these; this is the first concrete form. Every claim a plan
makes is a `PlanClaim`: the evidence taxonomy's `Claim`, plus the id of the upstream finding or
lesson it was carried forward from.

**Provenance is a reference, not a copy the model wrote.** The Planner may not invent `Measured`
or `Cited` content (agents.md §4.4). So a measured claim names the `finding_id` it rests on, a
cited one names the `lesson_id`, and the agent service copies the evidence across from that
finding or lesson. A model never authors a tool name, a checksum or a URL. A `chosen` claim has
no upstream, so its `source` is `None`.

**Plan-level agreement is the Plan Critic's job, not the schema's.** A stage that needs an item
the materials list lacks, or a time box that misses the budget, is a typed defect the artist is
shown (FR-702), not a validation error that loses the plan. The schema refuses only what no
producer may emit: an unclassified claim, a measured claim without its finding, a duplicate id.

Mirrored field for field by `packages/schemas/src/plan.ts`, and pinned by the parity fixture.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from artloupe.schemas.evidence import Cited, Claim, Measured

# The id an agent cites a finding, lesson, stage or material by. Short, so a model can copy it
# exactly, and constrained, so it can never carry prose or markup into a reference.
ReferenceId = Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[a-z][a-z0-9_-]*$")]


class Finding(BaseModel):
    """One measurement the Visual Analyst judged worth carrying into the plan."""

    model_config = ConfigDict(extra="forbid")

    finding_id: ReferenceId
    text: str = Field(min_length=1)
    evidence: Measured


class SetAside(BaseModel):
    """A measurement the Analyst declined to use, and why (FR-406's abstention, made visible)."""

    model_config = ConfigDict(extra="forbid")

    finding_id: ReferenceId
    reason: str = Field(min_length=1)


class VisualFindings(BaseModel):
    """The Visual Analyst's output. Every claim in it is `Measured`, and nothing else."""

    model_config = ConfigDict(extra="forbid")

    findings: list[Finding]
    set_aside: list[SetAside]

    @model_validator(mode="after")
    def _ids_unique(self) -> "VisualFindings":
        ids = [entry.finding_id for entry in [*self.findings, *self.set_aside]]
        if len(ids) != len(set(ids)):
            raise ValueError("a finding is either used or set aside, and named once")
        return self


LessonTopic = Literal["technique", "materials"]

LESSON_TOPICS: tuple[str, ...] = ("technique", "materials")


class CitedLesson(BaseModel):
    """One retrieved instructional passage, as the Planner may cite it. Every claim is `Cited`."""

    model_config = ConfigDict(extra="forbid")

    lesson_id: ReferenceId
    topic: LessonTopic
    title: str = Field(min_length=1)
    text: str = Field(min_length=1)
    evidence: Cited


class PlanClaim(Claim):
    """A plan's claim, with the id of the finding or lesson it was carried forward from."""

    # A `finding_id` for a measured claim, a `lesson_id` for a cited one, `None` for a chosen one.
    source: ReferenceId | None

    @model_validator(mode="after")
    def _source_matches_evidence(self) -> "PlanClaim":
        if self.evidence.kind == "chosen" and self.source is not None:
            raise ValueError("a chosen claim is the plan's own call, so it has no upstream source")
        if self.evidence.kind != "chosen" and self.source is None:
            raise ValueError("a measured or cited claim must name the finding or lesson behind it")
        return self


MaterialCategory = Literal["surface", "drawing", "paint", "brush", "tool"]

MATERIAL_CATEGORIES: tuple[str, ...] = ("surface", "drawing", "paint", "brush", "tool")


class MaterialItem(BaseModel):
    """One line of the materials list (FR-607): a brand-neutral specification, and why."""

    model_config = ConfigDict(extra="forbid")

    item_id: ReferenceId
    category: MaterialCategory
    # A class of thing, never a product: "hot-press watercolour paper, 300 gsm".
    specification: str = Field(min_length=1)
    claim: PlanClaim


class PlanStage(BaseModel):
    """One ordered, time-boxed stage of the plan (FR-601)."""

    model_config = ConfigDict(extra="forbid")

    stage_id: ReferenceId
    title: str = Field(min_length=1)
    minutes: int = Field(gt=0)
    goal: str = Field(min_length=1)
    # How the artist knows the stage is done. Something they check by eye, never the system.
    completion_signal: str = Field(min_length=1)
    # The `item_id`s this stage uses. The Plan Critic checks them against the list (FR-608).
    materials: list[ReferenceId]
    # What the stage rests on (FR-602). An empty list is a `missing_evidence` defect, not an error.
    claims: list[PlanClaim]


Suitability = Literal["good_fit", "workable", "poor_fit"]

SUITABILITIES: tuple[str, ...] = ("good_fit", "workable", "poor_fit")


class ReferenceAssessment(BaseModel):
    """The plan's opening: how well the photograph suits this intent, and why (FR-201-203)."""

    model_config = ConfigDict(extra="forbid")

    suitability: Suitability
    claims: list[PlanClaim]


class ProjectPlan(BaseModel):
    """The Studio Planner's output: the working plan the artist acts on (FR-600)."""

    model_config = ConfigDict(extra="forbid")

    assessment: ReferenceAssessment
    materials: list[MaterialItem]
    stages: list[PlanStage] = Field(min_length=1)
    # FR-605's self-check card: questions the artist asks of their own work. Never evaluated here.
    self_check: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def _ids_unique(self) -> "ProjectPlan":
        stage_ids = [stage.stage_id for stage in self.stages]
        item_ids = [item.item_id for item in self.materials]
        if len(stage_ids) != len(set(stage_ids)):
            raise ValueError("every stage needs its own stage_id")
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("every material needs its own item_id")
        return self


DefectCategory = Literal[
    "unsupported_measurement",
    "missing_evidence",
    "irrelevant_medium_advice",
    "infeasible_timebox",
    "unclassified_claim",
    "materials_mismatch",
    "policy_violation",
]

DEFECT_CATEGORIES: tuple[DefectCategory, ...] = DefectCategory.__args__  # type: ignore[attr-defined]

# The two categories that let a revision gather new evidence rather than only reword (FR-703).
EVIDENCE_DEFECTS: frozenset[str] = frozenset({"unsupported_measurement", "missing_evidence"})


class PlanDefect(BaseModel):
    """One thing wrong with the plan, in FR-702's closed vocabulary."""

    model_config = ConfigDict(extra="forbid")

    category: DefectCategory
    detail: str = Field(min_length=1)
    # The `stage_id` or `item_id` the defect is about, or `None` for the plan as a whole.
    location: str | None = None
    # `check` is the service's deterministic arithmetic; `critic` is the model's judgement.
    origin: Literal["check", "critic"]


Verdict = Literal["READY", "READY_WITH_CAUTION", "REVISE"]

VERDICTS: tuple[Verdict, ...] = Verdict.__args__  # type: ignore[attr-defined]


class CriticVerdict(BaseModel):
    """The Plan Critic's judgement of one version of the plan (FR-701)."""

    model_config = ConfigDict(extra="forbid")

    verdict: Verdict
    defects: list[PlanDefect]
    summary: str = Field(min_length=1)
    # Which plan version this judged: 0 is the first plan, 1 the revision (FR-704 allows one).
    revision: int = Field(ge=0, le=1)

    @model_validator(mode="after")
    def _ready_means_no_defects(self) -> "CriticVerdict":
        if self.verdict == "READY" and self.defects:
            raise ValueError("a plan with open defects is not READY")
        if self.verdict == "REVISE" and self.revision == 1:
            raise ValueError("the revision is the last one; an unresolved plan ships with caution")
        return self


class PlanOutcome(BaseModel):
    """Everything the plan half of a run produced, as the `succeeded` event carries it."""

    model_config = ConfigDict(extra="forbid")

    findings: VisualFindings
    lessons: list[CitedLesson]
    plan: ProjectPlan
    # One verdict per plan version, oldest first. The last one is the plan's standing (FR-705).
    verdicts: list[CriticVerdict] = Field(min_length=1, max_length=2)
