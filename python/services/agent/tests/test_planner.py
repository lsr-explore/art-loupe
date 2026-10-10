"""The Studio Planner's draft, resolved: provenance by reference, a defect per dangling one.

`resolve_plan` is the whole of the provenance rule, so most of this suite drives it directly. The
model call itself is a recorded responder.
"""

from typing import Any

import pytest
from agent_support import FINDINGS, LESSONS, RecordedDirector, claim, director_reply, plan_draft

from artloupe.agent.planner import PlanDraft, PlanningFailed, ask_planner, resolve_plan
from artloupe.schemas import CriticVerdict

pytestmark = pytest.mark.trace(flow="plan.synthesis", category="functionality")


def draft(**changes: Any) -> PlanDraft:
    return PlanDraft.model_validate(
        {**plan_draft(finding="value_map", lesson="fx-oil-materials"), **changes}
    )


def test_each_basis_resolves_to_the_evidence_it_names() -> None:
    plan, defects = resolve_plan(draft(), FINDINGS, LESSONS)

    assert defects == []
    assert plan.assessment.claims[0].evidence == FINDINGS.findings[0].evidence
    assert plan.assessment.claims[0].source == "value_map"
    assert plan.materials[0].claim.evidence == LESSONS[0].evidence
    stage_claim = plan.stages[0].claims[0]
    assert stage_claim.evidence.kind == "chosen"
    assert stage_claim.source is None


@pytest.mark.parametrize(
    ("dangling", "category"),
    [
        (claim("finding", "value_map_2"), "unsupported_measurement"),
        (claim("lesson", "fx-tonal-key"), "missing_evidence"),
        ({**claim("choice"), "rejected_alternative": None}, "unclassified_claim"),
    ],
    ids=["an unreported finding", "an unretrieved lesson", "a choice without its alternative"],
)
def test_a_claim_that_cannot_resolve_is_dropped_and_becomes_a_defect(
    dangling: dict[str, Any], category: str
) -> None:
    """Never invented, never silently kept: the Plan Critic carries it to the artist."""
    stages = plan_draft(finding="value_map", lesson="fx-oil-materials")["stages"]
    stages[0]["claims"] = [dangling, claim("choice")]

    plan, defects = resolve_plan(draft(stages=stages), FINDINGS, LESSONS)

    assert len(plan.stages[0].claims) == 1
    (defect,) = defects
    assert defect.category == category
    assert defect.origin == "check"
    assert defect.location == "stage-1"


def test_a_material_whose_reason_cannot_resolve_leaves_the_list() -> None:
    materials = plan_draft(finding="value_map", lesson="fx-oil-materials")["materials"]
    materials[0]["claim"] = claim("lesson", "fx-unretrieved")

    plan, defects = resolve_plan(draft(materials=materials), FINDINGS, LESSONS)

    assert plan.materials == []
    assert [defect.location for defect in defects] == ["brush"]


@pytest.mark.parametrize(
    "changes",
    [
        {"stages": []},
        {"stages": plan_draft(finding="value_map", lesson="l", minutes=(30, 30))["stages"][:1] * 2},
        {"self_check": ["  "]},
    ],
    ids=["no stages", "a duplicate stage id", "no self-check question"],
)
def test_what_is_not_a_plan_at_all_stops_the_run(changes: dict[str, Any]) -> None:
    with pytest.raises(PlanningFailed):
        resolve_plan(draft(**changes), FINDINGS, LESSONS)


async def test_a_revision_is_shown_the_previous_plan_and_its_verdict() -> None:
    previous, _ = resolve_plan(draft(), FINDINGS, LESSONS)
    verdict = CriticVerdict(
        verdict="REVISE",
        defects=[
            {
                "category": "infeasible_timebox",
                "detail": "The stages add up to 60 minutes.",
                "location": None,
                "origin": "check",
            }
        ],
        summary="Too short.",
        revision=0,
    )
    recorded = RecordedDirector(
        director_reply(plan_draft(finding="value_map", lesson="fx-oil-materials"))
    )

    await ask_planner(
        recorded.client,
        intent={"medium": "oil", "time_budget_minutes": 90},
        findings=FINDINGS,
        lessons=LESSONS,
        previous=previous,
        verdict=verdict,
    )

    user = recorded.bodies[0]["messages"][0]["content"]
    assert "<revision>" in user
    assert "The stages add up to 60 minutes." in user


async def test_a_first_plan_is_written_without_a_revision_block() -> None:
    recorded = RecordedDirector(
        director_reply(plan_draft(finding="value_map", lesson="fx-oil-materials"))
    )

    plan, defects = await ask_planner(
        recorded.client,
        intent={"medium": "oil", "time_budget_minutes": 90},
        findings=FINDINGS,
        lessons=LESSONS,
    )

    assert "<revision>" not in recorded.bodies[0]["messages"][0]["content"]
    assert [stage.minutes for stage in plan.stages] == [60, 30]
    assert defects == []
