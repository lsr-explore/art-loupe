"""The Plan Critic: the checks arithmetic owns, and the verdict bounds the service enforces."""

from typing import Any

import pytest
from agent_support import (
    FINDINGS,
    LESSONS,
    RecordedDirector,
    critic_reply,
    plan_draft,
    project_data,
)

from artloupe.agent.critic import ask_critic, check_plan, settle_verdict
from artloupe.agent.planner import PlanDraft, resolve_plan
from artloupe.schemas import PlanDefect, ProjectPlan

# The Analyst's catalog entry behind `FINDINGS`, as the model saw it.
MEASUREMENTS = {
    "value_map": {
        "finding_id": "value_map",
        "tool": "value_map",
        "figures": {"darkest_share": 0.31},
        "confidence": None,
        "limitations": [],
    }
}

pytestmark = pytest.mark.trace(flow="plan.critique", category="functionality")


def plan(minutes: tuple[int, ...] = (60, 30), **changes: Any) -> ProjectPlan:
    draft = {**plan_draft(finding="value_map", lesson="fx-oil-materials", minutes=minutes)}
    draft.update(changes)
    resolved, _ = resolve_plan(PlanDraft.model_validate(draft), FINDINGS, LESSONS)
    return resolved


def categories(defects: list[PlanDefect]) -> list[str]:
    return [defect.category for defect in defects]


def test_a_plan_that_agrees_with_itself_and_its_budget_passes_every_check() -> None:
    assert check_plan(plan(), time_budget_minutes=90) == []


@pytest.mark.parametrize(
    ("minutes", "budget", "fires"),
    [((50, 40), 99, False), ((50, 40), 100, False), ((50, 40), 101, True), ((50, 40), 82, False)],
    ids=["within, below", "on the edge", "just outside", "within, above"],
)
def test_the_timebox_allows_ten_percent_either_way(
    minutes: tuple[int, ...], budget: int, fires: bool
) -> None:
    """FR-601. 90 minutes against 101 misses by 11; against 82 it exceeds by 8, under 8.2."""
    defects = check_plan(plan(minutes), time_budget_minutes=budget)
    assert ("infeasible_timebox" in categories(defects)) is fires


def test_materials_and_stages_must_agree_in_both_directions() -> None:
    """FR-608: a stage needing an unlisted item, and a listed item no stage uses."""
    stages = plan_draft(finding="value_map", lesson="fx-oil-materials")["stages"]
    for stage in stages:
        stage["materials"] = ["kneaded-eraser"]

    defects = check_plan(plan(stages=stages), time_budget_minutes=90)

    assert categories(defects) == ["materials_mismatch"] * 3
    assert [defect.location for defect in defects] == ["stage-1", "stage-2", "brush"]


def test_a_stage_resting_on_nothing_and_an_unmeasured_assessment_are_missing_evidence() -> None:
    stages = plan_draft(finding="value_map", lesson="fx-oil-materials")["stages"]
    stages[0]["claims"] = []
    assessment = {"suitability": "workable", "claims": []}

    defects = check_plan(plan(stages=stages, assessment=assessment), time_budget_minutes=90)

    assert categories(defects) == ["missing_evidence", "missing_evidence"]
    assert [defect.location for defect in defects] == ["stage-1", None]


@pytest.mark.parametrize(
    ("proposed", "has_defects", "revision", "settled"),
    [
        ("REVISE", False, 0, "READY"),
        ("READY", True, 0, "REVISE"),
        ("READY_WITH_CAUTION", True, 0, "READY_WITH_CAUTION"),
        ("REVISE", True, 0, "REVISE"),
        ("REVISE", True, 1, "READY_WITH_CAUTION"),
        ("READY", True, 1, "READY_WITH_CAUTION"),
    ],
)
def test_the_verdict_is_held_inside_fr_704s_bounds(
    proposed: str, has_defects: bool, revision: int, settled: str
) -> None:
    defects = (
        [PlanDefect(category="infeasible_timebox", detail="d", origin="check")]
        if has_defects
        else []
    )
    assert settle_verdict(proposed, defects, revision=revision) == settled  # type: ignore[arg-type]


async def test_the_checks_and_the_model_merge_into_one_verdict() -> None:
    recorded = RecordedDirector(
        critic_reply(
            "READY",
            [
                {
                    "category": "irrelevant_medium_advice",
                    "detail": "Colour mixing has no place in this plan.",
                    "location": "stage-2",
                }
            ],
        )
    )

    verdict = await ask_critic(
        recorded.client,
        intent={"medium": "oil", "time_budget_minutes": 60},
        plan=plan(),
        findings=FINDINGS,
        measurements=MEASUREMENTS,
        lessons=LESSONS,
        unresolved=[],
        revision=0,
    )

    assert verdict.verdict == "REVISE"
    assert [(defect.category, defect.origin) for defect in verdict.defects] == [
        ("infeasible_timebox", "check"),
        ("irrelevant_medium_advice", "critic"),
    ]
    # The model is told what the checks found, so it does not report them again.
    shown = project_data(recorded.bodies[0])["defects_already_found"]
    assert [entry["category"] for entry in shown] == ["infeasible_timebox"]


async def test_each_finding_reaches_the_critic_with_the_figures_it_was_written_from() -> None:
    """A sentence that misquotes its measurement is only catchable beside the measurement."""
    recorded = RecordedDirector(critic_reply("READY"))

    await ask_critic(
        recorded.client,
        intent={"medium": "oil", "time_budget_minutes": 90},
        plan=plan(),
        findings=FINDINGS,
        measurements=MEASUREMENTS,
        lessons=LESSONS,
        unresolved=[],
        revision=0,
    )

    (finding,) = project_data(recorded.bodies[0])["findings"]
    assert finding["measurement"]["figures"] == {"darkest_share": 0.31}


async def test_the_planners_dropped_claims_reach_the_verdict() -> None:
    dropped = PlanDefect(
        category="unsupported_measurement", detail="dropped", location="stage-1", origin="check"
    )
    recorded = RecordedDirector(critic_reply("READY"))

    verdict = await ask_critic(
        recorded.client,
        intent={"medium": "oil", "time_budget_minutes": 90},
        plan=plan(),
        findings=FINDINGS,
        measurements=MEASUREMENTS,
        lessons=LESSONS,
        unresolved=[dropped],
        revision=1,
    )

    assert verdict.defects == [dropped]
    assert verdict.verdict == "READY_WITH_CAUTION"
    assert verdict.revision == 1
