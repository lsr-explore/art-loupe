"""Whole runs through the plan half of the graph, including the one revision FR-704 allows.

Every model is a recorded responder and the face detector is stubbed, as in `test_graph.py`.
What is under test is where the run goes after the Plan Critic: out, back to the Planner, or back
through the lesson source first when the defects were about evidence (FR-703).
"""

import json

import pytest
from agent_support import (
    EVERY_OFFERED_WITHOUT_A_FACE,
    OWNER,
    PROJECT_ID,
    SENTINEL_API_KEY,
    Detector,
    FakeArtistApi,
    RecordedDirector,
    critic_reply,
    director_reply,
    planner_writes,
    project_data,
    whole_run,
)

from artloupe.agent.graph import build_graph
from artloupe.agent.jobs import plan_outcome
from artloupe.agent.planner import PlanningFailed
from artloupe.agent.resources import RunResources
from artloupe.agent.runtime import RunOutcome, execute_run
from artloupe.metering import InMemoryMetricsSink, RunGuards

pytestmark = pytest.mark.trace(flow="plan.critique", category="functionality")

GENEROUS = RunGuards(
    recursion_limit=25, node_visit_limit=10, wall_clock_seconds=60.0, token_ceiling=1_000_000
)
UP_TO_ANALYSE = ["load_project", "face_gate", "survey", "direct", "analyse", "interpret"]

TIMEBOX_DEFECT = {
    "category": "infeasible_timebox",
    "detail": "The second stage is too short for a beginner.",
    "location": "stage-2",
}


async def run(api: FakeArtistApi, director: RecordedDirector) -> RunOutcome:
    return await execute_run(
        build_graph(),
        {"run_id": "run-1", "owner": OWNER, "project_id": PROJECT_ID, "node_trail": []},
        run_id="run-1",
        owner=OWNER,
        guards=GENEROUS,
        sink=InMemoryMetricsSink(),
        resources=RunResources(api=api, director=director.client),  # type: ignore[arg-type]
    )


@pytest.mark.trace(flow="plan.synthesis", category="functionality")
async def test_a_ready_plan_ends_the_run_with_one_verdict(
    api: FakeArtistApi, detector: Detector
) -> None:
    outcome = await run(api, RecordedDirector(*whole_run(EVERY_OFFERED_WITHOUT_A_FACE)))

    assert outcome.state["node_trail"][-3:] == ["gather_lessons", "plan", "critique"]
    result = plan_outcome(outcome.state)
    assert [verdict.verdict for verdict in result.verdicts] == ["READY"]
    assert result.lessons[0].lesson_id == "fx-oil-materials"
    # The measured claim in the plan carries the Analyst's evidence, quoted from the run's tools.
    measured = result.plan.assessment.claims[0]
    assert measured.evidence.kind == "measured"
    assert measured.evidence.source_checksum == outcome.state["source_checksum"]


async def test_the_critic_is_shown_the_figures_behind_every_finding(
    api: FakeArtistApi, detector: Detector
) -> None:
    director = RecordedDirector(*whole_run(EVERY_OFFERED_WITHOUT_A_FACE))

    outcome = await run(api, director)

    critic_findings = project_data(director.bodies[3])["findings"]
    value_map = next(entry for entry in critic_findings if entry["finding_id"] == "value_map")
    shares = outcome.state["survey"]["values"]["shares"]
    assert value_map["measurement"]["figures"]["shares_darkest_first"] == shares


async def test_a_revise_without_an_evidence_defect_goes_straight_back_to_the_planner(
    api: FakeArtistApi, detector: Detector
) -> None:
    director = RecordedDirector(
        *whole_run(
            EVERY_OFFERED_WITHOUT_A_FACE,
            planner_writes(),
            critic_reply("REVISE", [TIMEBOX_DEFECT]),
            planner_writes(),
            critic_reply("READY"),
        )
    )

    outcome = await run(api, director)

    assert outcome.state["node_trail"] == [
        *UP_TO_ANALYSE,
        "gather_lessons",
        "plan",
        "critique",
        "plan",
        "critique",
    ]
    result = plan_outcome(outcome.state)
    assert [(verdict.verdict, verdict.revision) for verdict in result.verdicts] == [
        ("REVISE", 0),
        ("READY", 1),
    ]
    # The revision was written with the verdict in hand.
    revision_request = director.bodies[4]["messages"][0]["content"]
    assert TIMEBOX_DEFECT["detail"] in revision_request


async def test_an_evidence_defect_gathers_lessons_again_before_the_revision(
    api: FakeArtistApi, detector: Detector
) -> None:
    """FR-703: a Plan Critic that only triggers rewording is not a verification loop."""
    defect = {
        "category": "missing_evidence",
        "detail": "The perspective stage cites nothing about vanishing points or the horizon.",
        "location": "stage-1",
    }
    director = RecordedDirector(
        *whole_run(
            EVERY_OFFERED_WITHOUT_A_FACE,
            planner_writes(),
            critic_reply("REVISE", [defect]),
            planner_writes(),
            critic_reply("READY"),
        )
    )

    outcome = await run(api, director)

    trail = outcome.state["node_trail"]
    assert trail[len(UP_TO_ANALYSE) :] == [
        "gather_lessons",
        "plan",
        "critique",
        "gather_lessons",
        "plan",
        "critique",
    ]
    # The defect's own words found a lesson the first query did not, and the first lessons stay.
    first_lessons = [entry["lesson_id"] for entry in project_data(director.bodies[2])["lessons"]]
    revised_lessons = [entry["lesson_id"] for entry in project_data(director.bodies[4])["lessons"]]
    assert "fx-perspective" not in first_lessons
    assert "fx-perspective" in revised_lessons
    assert set(first_lessons) <= set(revised_lessons)


async def test_a_second_revise_ships_with_caution_and_never_plans_a_third_time(
    api: FakeArtistApi, detector: Detector
) -> None:
    """FR-704: one automatic revision, then the open defects are shown rather than hidden."""
    director = RecordedDirector(
        *whole_run(
            EVERY_OFFERED_WITHOUT_A_FACE,
            planner_writes(),
            critic_reply("REVISE", [TIMEBOX_DEFECT]),
            planner_writes(),
            critic_reply("REVISE", [TIMEBOX_DEFECT]),
        )
    )

    outcome = await run(api, director)

    assert outcome.state["node_trail"].count("plan") == 2
    final = plan_outcome(outcome.state).verdicts[-1]
    assert final.verdict == "READY_WITH_CAUTION"
    assert [defect.detail for defect in final.defects] == [TIMEBOX_DEFECT["detail"]]
    assert director.replies == []


async def test_a_planner_draft_that_is_no_plan_fails_the_run(
    api: FakeArtistApi, detector: Detector
) -> None:
    director = RecordedDirector(
        director_reply(EVERY_OFFERED_WITHOUT_A_FACE),
        *whole_run(EVERY_OFFERED_WITHOUT_A_FACE)[1:2],
        director_reply(
            {
                "assessment": {"suitability": "workable", "claims": []},
                "materials": [],
                "stages": [],
                "self_check": ["q"],
            }
        ),
    )

    with pytest.raises(PlanningFailed):
        await run(api, director)


@pytest.mark.trace(flow="platform.agent-runtime", category="security")
async def test_the_plan_state_holds_no_credential(api: FakeArtistApi, detector: Detector) -> None:
    outcome = await run(api, RecordedDirector(*whole_run(EVERY_OFFERED_WITHOUT_A_FACE)))

    assert SENTINEL_API_KEY not in json.dumps(outcome.state)
