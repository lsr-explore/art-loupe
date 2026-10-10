"""The fixture lesson source: what it returns, and that it can never pass for a real citation."""

import pytest

from artloupe.agent.lessons import (
    FIXTURE_INSTITUTION,
    FIXTURE_LESSONS,
    LESSON_LIMIT,
    FixtureLessonSource,
    LessonQuery,
)

pytestmark = pytest.mark.trace(flow="plan.synthesis", category="functionality")


async def test_the_mediums_own_materials_lesson_comes_first() -> None:
    lessons = await FixtureLessonSource().search(
        LessonQuery(medium="watercolour", skill_level="beginner")
    )

    assert lessons[0].lesson_id == "fx-watercolour-materials"
    assert lessons[0].topic == "materials"
    assert len(lessons) == LESSON_LIMIT


async def test_no_lesson_for_another_medium_is_returned() -> None:
    lessons = await FixtureLessonSource().search(
        LessonQuery(medium="graphite", skill_level="advanced", terms=("paint palette wash",))
    )

    assert [lesson.lesson_id for lesson in lessons if lesson.topic == "materials"] == [
        "fx-graphite-materials"
    ]


async def test_the_terms_decide_which_technique_lessons_are_returned() -> None:
    """What lets an evidence revision find a lesson the first query did not return (FR-703)."""
    source = FixtureLessonSource()
    plain = await source.search(LessonQuery(medium="oil", skill_level="intermediate"))
    asked = await source.search(
        LessonQuery(medium="oil", skill_level="intermediate", terms=("vanishing point horizon",))
    )

    assert "fx-perspective" not in {lesson.lesson_id for lesson in plain}
    assert "fx-perspective" in {lesson.lesson_id for lesson in asked}


@pytest.mark.trace(flow="retrieval.grounding", category="safety")
async def test_a_fixture_lesson_announces_itself_wherever_it_is_cited() -> None:
    """A placeholder citation must never pass for a published source."""
    for medium in ("graphite", "oil"):
        for lesson in await FixtureLessonSource().search(
            LessonQuery(medium=medium, skill_level="beginner")  # type: ignore[arg-type]
        ):
            assert lesson.evidence.institution == FIXTURE_INSTITUTION
            assert lesson.evidence.url.startswith("https://example.invalid/")
            assert "Not a published source" in lesson.evidence.licence
            assert lesson.evidence.passage_span.end == len(lesson.text)


def test_every_fixture_lesson_has_its_own_id() -> None:
    ids = [lesson.lesson_id for lesson in FIXTURE_LESSONS]
    assert len(ids) == len(set(ids))
