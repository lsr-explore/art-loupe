"""The plan half of the graph: interpret, gather lessons, plan, critique, and revise at most once.

```text
analyse → interpret → gather_lessons → plan → critique ─┬─ READY / READY_WITH_CAUTION → END
                            ▲            ▲               │
                            │            └── REVISE ─────┤  (reword)
                            └────── REVISE + evidence ───┘  (FR-703: gather again, then plan)
```

`after_critique` is the graph's one branch, and it branches on the Plan Critic's result. A
`REVISE` whose defects include `unsupported_measurement` or `missing_evidence` goes back through
`gather_lessons` with the defects as the query, so the revision can rest on evidence the first
plan did not have. Any other `REVISE` goes straight back to `plan`. FR-704 allows one revision:
the Critic settles a second `REVISE` as `READY_WITH_CAUTION`, so the loop cannot run twice.

The Analyst, the Planner and the Critic share the run's one model client, which the service
supplies as `RunResources.director` because the Director was its first user.
"""

from typing import Any, Literal

from anthropic import AsyncAnthropic

from artloupe.agent.analyst import ask_analyst, measurement_catalog
from artloupe.agent.critic import ask_critic
from artloupe.agent.lessons import LessonQuery
from artloupe.agent.planner import ask_planner
from artloupe.agent.resources import run_resources
from artloupe.agent.state import RunState
from artloupe.schemas import (
    EVIDENCE_DEFECTS,
    CitedLesson,
    CriticVerdict,
    PlanDefect,
    ProjectIntent,
    ProjectPlan,
    RoutingDecision,
    VisualFindings,
)


def _model_client() -> AsyncAnthropic:
    client = run_resources().director
    if client is None:
        raise RuntimeError("this run has no model client; the service supplies one per run")
    return client


async def interpret(state: RunState) -> dict[str, Any]:
    """The Visual Analyst's judgement over every measurement the run holds."""
    catalog = measurement_catalog(
        survey=state["survey"], gate=state["gate"], artifacts=state["artifacts"]
    )
    findings = await ask_analyst(_model_client(), intent=state["intent"], catalog=catalog)
    return {
        "findings": findings.model_dump(mode="json"),
        # Kept so the Plan Critic can hold each finding's sentence against its figures.
        "measurements": {entry.finding_id: entry.shown() for entry in catalog},
        "node_trail": ["interpret"],
    }


async def gather_lessons(state: RunState) -> dict[str, Any]:
    """Ask the lesson source for what this plan can cite.

    The first time, the terms are the selected tools and the findings the Analyst used. On an
    evidence revision, they are the open evidence defects' own words. Lessons already gathered are
    kept, so a revision can still cite what the first plan cited.
    """
    intent = ProjectIntent.model_validate(state["intent"])
    verdicts = [CriticVerdict.model_validate(entry) for entry in state.get("verdicts", [])]
    if verdicts:
        terms = tuple(
            defect.detail for defect in verdicts[-1].defects if defect.category in EVIDENCE_DEFECTS
        )
    else:
        routing = RoutingDecision.model_validate(state["routing"])
        findings = VisualFindings.model_validate(state["findings"])
        terms = (
            *(entry.tool.replace("_", " ") for entry in routing.manifest.selected),
            *(finding.text for finding in findings.findings),
        )

    found = await run_resources().lessons.search(
        LessonQuery(medium=intent.medium, skill_level=intent.skill_level, terms=terms)
    )
    lessons = {entry["lesson_id"]: entry for entry in state.get("lessons", [])}
    for lesson in found:
        lessons.setdefault(lesson.lesson_id, lesson.model_dump(mode="json"))
    return {"lessons": list(lessons.values()), "node_trail": ["gather_lessons"]}


async def plan(state: RunState) -> dict[str, Any]:
    """Write the plan, or on revision write it again with the verdict in hand."""
    verdicts = [CriticVerdict.model_validate(entry) for entry in state.get("verdicts", [])]
    previous = ProjectPlan.model_validate(state["plan"]) if verdicts else None
    written, unresolved = await ask_planner(
        _model_client(),
        intent=state["intent"],
        findings=VisualFindings.model_validate(state["findings"]),
        lessons=[CitedLesson.model_validate(entry) for entry in state["lessons"]],
        previous=previous,
        verdict=verdicts[-1] if verdicts else None,
    )
    return {
        "plan": written.model_dump(mode="json"),
        "unresolved": [defect.model_dump(mode="json") for defect in unresolved],
        "revision": len(verdicts),
        "node_trail": ["plan"],
    }


async def critique(state: RunState) -> dict[str, Any]:
    """Judge the plan as it stands. The verdict is appended, so the first one is never lost."""
    verdict = await ask_critic(
        _model_client(),
        intent=state["intent"],
        plan=ProjectPlan.model_validate(state["plan"]),
        findings=VisualFindings.model_validate(state["findings"]),
        measurements=state["measurements"],
        lessons=[CitedLesson.model_validate(entry) for entry in state["lessons"]],
        unresolved=[PlanDefect.model_validate(entry) for entry in state["unresolved"]],
        revision=state["revision"],
    )
    return {"verdicts": [verdict.model_dump(mode="json")], "node_trail": ["critique"]}


def after_critique(state: RunState) -> Literal["gather_lessons", "plan", "__end__"]:
    """Where the run goes once the plan has been judged."""
    verdict = CriticVerdict.model_validate(state["verdicts"][-1])
    if verdict.verdict != "REVISE":
        return "__end__"
    if any(defect.category in EVIDENCE_DEFECTS for defect in verdict.defects):
        return "gather_lessons"
    return "plan"
