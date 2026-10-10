"""Where the Studio Planner's lessons come from, until the Art Tutor joins the graph.

The Planner consumes `CitedLesson[]` (`agents.md` §4.4), and every plan needs a materials list
(FR-607), so a plan cannot be written without lessons. The Art Tutor, which owns retrieval, is not
in the graph yet, and the learning corpus it will search is moving to pgvector on another branch.
`LessonSource` is the seam the Tutor replaces. It changes this module and nothing downstream.

**The fixture is not a source, and says so.** Every fixture lesson names its institution as
"Art Loupe fixture lessons", carries a `.invalid` URL, and states in its licence that it is not a
published source. A cited claim resting on one is visibly a placeholder wherever it is rendered.
The text is general studio practice written for development. It is brand-neutral (FR-1009), and
nothing in it was taken from a published work.

The query is deliberately small: the medium, the skill level, and free terms. A revision that
was told it lacked evidence (FR-703) asks again with the defects' own words as terms, which is
what lets it find a lesson the first query did not return.
"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from artloupe.schemas import Cited, CitedLesson, LessonTopic, Medium, PassageSpan, SkillLevel

FIXTURE_INSTITUTION = "Art Loupe fixture lessons"
FIXTURE_LICENCE = "Fixture text written for development. Not a published source."
FIXTURE_RETRIEVED_AT = datetime(2026, 10, 9, tzinfo=UTC)

# The most lessons one query returns: the materials lesson and four technique lessons. Fewer than
# the fixture holds, so the terms decide which technique lessons a plan sees.
LESSON_LIMIT = 5


@dataclass(frozen=True)
class LessonQuery:
    medium: Medium
    skill_level: SkillLevel
    terms: tuple[str, ...] = ()


class LessonSource(Protocol):
    """Anything that answers a lesson query with cited lessons. The Art Tutor will be one."""

    async def search(self, query: LessonQuery) -> list[CitedLesson]: ...


@dataclass(frozen=True)
class _FixtureLesson:
    lesson_id: str
    topic: LessonTopic
    title: str
    text: str
    # `None` applies to every medium.
    media: frozenset[str] | None
    tags: frozenset[str]


def _lesson(
    lesson_id: str,
    topic: LessonTopic,
    title: str,
    text: str,
    *,
    media: tuple[str, ...] | None = None,
    tags: tuple[str, ...] = (),
) -> _FixtureLesson:
    return _FixtureLesson(
        lesson_id=lesson_id,
        topic=topic,
        title=title,
        text=text,
        media=frozenset(media) if media is not None else None,
        tags=frozenset(tags),
    )


FIXTURE_LESSONS: tuple[_FixtureLesson, ...] = (
    _lesson(
        "fx-graphite-materials",
        "materials",
        "Graphite: grades and paper",
        "A range of grades from a hard 2H to a soft 6B covers light construction lines through "
        "the deepest darks. Smooth drawing paper of around 150 gsm takes fine detail; a paper "
        "with more tooth holds more graphite in the darks. A kneaded eraser lifts highlights "
        "without abrading the surface.",
        media=("graphite",),
        tags=("materials", "paper", "pencil", "eraser", "grades", "darks"),
    ),
    _lesson(
        "fx-charcoal-materials",
        "materials",
        "Charcoal: sticks, pencils and paper",
        "Vine charcoal lays in soft, easily corrected masses; compressed charcoal reaches a "
        "deeper black but is harder to lift. Charcoal paper with a pronounced tooth holds the "
        "dust. A kneaded eraser and a blending stump shape edges and pull out lights.",
        media=("charcoal",),
        tags=("materials", "paper", "eraser", "blending", "darks"),
    ),
    _lesson(
        "fx-ink-materials",
        "materials",
        "Ink: pens, brushes and paper",
        "A waterproof ink allows washes over line work once dry. Fine-nib pens give even lines; "
        "a round brush gives lines that swell and taper. Smooth, heavy paper of around 250 gsm "
        "resists feathering and buckling under washes.",
        media=("ink",),
        tags=("materials", "paper", "pen", "brush", "wash"),
    ),
    _lesson(
        "fx-coloured-pencil-materials",
        "materials",
        "Coloured pencil: pencils and surface",
        "Wax- or oil-based coloured pencils build colour in thin layers. A smooth, heavy paper "
        "takes many layers before the tooth fills. A colourless blender pencil fuses layers; a "
        "sharpener that keeps a long point helps with edges.",
        media=("coloured-pencil",),
        tags=("materials", "paper", "pencil", "layers", "blending"),
    ),
    _lesson(
        "fx-watercolour-materials",
        "materials",
        "Watercolour: paper, brushes and paint",
        "Cold-press watercolour paper of 300 gsm takes repeated washes without buckling badly. A "
        "large round brush carries washes and a smaller round handles detail. A limited palette "
        "of a warm and a cool of each primary mixes most colours. Masking tape holds the paper "
        "flat while washes dry.",
        media=("watercolour",),
        tags=("materials", "paper", "brush", "paint", "palette", "wash"),
    ),
    _lesson(
        "fx-acrylic-materials",
        "materials",
        "Acrylic: paint, brushes and support",
        "Acrylic dries quickly, so a stay-wet palette or a mister keeps paint workable. Synthetic "
        "flat and filbert brushes in a few sizes cover blocking in and edges. A primed canvas "
        "panel or heavy primed paper is a stable support.",
        media=("acrylic",),
        tags=("materials", "brush", "paint", "palette", "support"),
    ),
    _lesson(
        "fx-oil-materials",
        "materials",
        "Oil: paint, medium, brushes and support",
        "A limited palette of titanium white and a warm and a cool of each primary covers most "
        "subjects. An odourless solvent thins the first layers; a slower medium suits later "
        "ones, following fat over lean. Hog-bristle filberts move paint; a soft round handles "
        "detail. A primed panel or canvas is the support.",
        media=("oil",),
        tags=("materials", "brush", "paint", "palette", "medium", "support"),
    ),
    _lesson(
        "fx-value-massing",
        "technique",
        "Massing values before detail",
        "Group the photograph into a few large value shapes before drawing any detail. Placing "
        "the darkest masses first sets the range every later value is judged against, and keeps "
        "the image legible at a distance.",
        tags=("value", "values", "darks", "massing", "block-in", "shapes"),
    ),
    _lesson(
        "fx-value-compression",
        "technique",
        "Working with a compressed value range",
        "When most of a photograph sits in a narrow band of values, choose where to exaggerate the "
        "separation. Keeping the full range for the focal area and compressing the rest directs "
        "attention without inventing light.",
        tags=("value", "values", "contrast", "range", "focal"),
    ),
    _lesson(
        "fx-edges",
        "technique",
        "Hard and soft edges",
        "Reserve the hardest edges and strongest contrasts for the focal area. Softening or "
        "losing edges elsewhere lets forms turn and keeps secondary areas quiet.",
        tags=("edges", "focal", "outline", "contrast"),
    ),
    _lesson(
        "fx-block-in",
        "technique",
        "Blocking in with straight lines",
        "Block in the large shapes with straight lines first, checking angles and proportions "
        "against each other. Curves and detail come only once the big shapes are placed.",
        tags=("block-in", "outline", "proportion", "shapes", "lines"),
    ),
    _lesson(
        "fx-perspective",
        "technique",
        "Using vanishing points",
        "Lines that recede in parallel converge on a vanishing point on the horizon. Marking the "
        "horizon and the vanishing points before drawing receding edges keeps them consistent.",
        tags=("perspective", "vanishing", "horizon", "lines"),
    ),
    _lesson(
        "fx-head-construction",
        "technique",
        "Constructing the head",
        "A simple construction — a sphere for the cranium, a plane for the side of the head, and "
        "guide lines for the brow, nose and chin — places the features before any likeness is "
        "attempted. The construction follows the tilt and turn of the head.",
        tags=("head", "face", "portrait", "construction", "proportion"),
    ),
    _lesson(
        "fx-time-boxing",
        "technique",
        "Time-boxing a study",
        "A short study works best when most of the time goes to the large shapes and values. "
        "Leave detail to the final quarter of the time, and stop when the time box ends rather "
        "than polishing one area.",
        tags=("time", "study", "beginner", "planning"),
    ),
)

_WORD = re.compile(r"[a-z][a-z-]+")


def _cited(lesson: _FixtureLesson) -> CitedLesson:
    return CitedLesson(
        lesson_id=lesson.lesson_id,
        topic=lesson.topic,
        title=lesson.title,
        text=lesson.text,
        evidence=Cited(
            chunk_id=lesson.lesson_id,
            institution=FIXTURE_INSTITUTION,
            url=f"https://example.invalid/fixture-lessons/{lesson.lesson_id}",
            licence=FIXTURE_LICENCE,
            retrieved_at=FIXTURE_RETRIEVED_AT,
            passage_span=PassageSpan(start=0, end=len(lesson.text)),
        ),
    )


class FixtureLessonSource:
    """The fixture lessons, ranked by how many of the query's terms each one's tags share.

    The medium's own materials lesson always comes first, because the plan cannot list materials
    without it. Lessons for another medium are never returned.
    """

    async def search(self, query: LessonQuery) -> list[CitedLesson]:
        words = {word for term in query.terms for word in _WORD.findall(term.lower())}
        eligible = [
            lesson
            for lesson in FIXTURE_LESSONS
            if lesson.media is None or query.medium in lesson.media
        ]

        def rank(lesson: _FixtureLesson) -> tuple[int, int]:
            own_materials = lesson.topic == "materials"
            return (0 if own_materials else 1, -len(lesson.tags & words))

        ranked = sorted(eligible, key=rank)
        return [_cited(lesson) for lesson in ranked[:LESSON_LIMIT]]
