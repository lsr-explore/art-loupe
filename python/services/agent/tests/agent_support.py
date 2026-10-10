"""Stand-ins for the agent's suites: the artist's Supabase data, a photograph, and a face.

Not `conftest.py`, for the reason `libs/persistence/tests/db_support.py` gives: this workspace
already has a root `conftest.py`, so importing from a module named `conftest` depends on
collection order. The fixtures stay in `conftest.py`; the things a test names live here.

**No MediaPipe anywhere in these suites.** A real detection closes a landmarker, and every close
sends Google a usage report (#43). The detector is tested where it lives, in `libs/image-tools`.
Here it is replaced by `synthetic_face()` — a *valid* `DetectedFace`, so the cache's JSON round
trip is exercised for real rather than around a mock.

**No Anthropic API call either.** `RecordedDirector` is a real SDK client whose network is
replaced, so a test sees the request as it would leave the process and the node reads a real SDK
response. The replies are hand-authored in the Messages API's wire shape. They were not captured
from the API, and `test_director_live.py` is the one test that calls it.
"""

import hashlib
import json
from collections.abc import Callable, Mapping
from typing import Any

import cv2
import httpx2
import numpy as np
from anthropic import AsyncAnthropic, DefaultAsyncHttpxClient

from artloupe.image_tools import (
    ANCHOR_LANDMARKS,
    Anchor,
    DetectedFace,
    FacialLandmarkReliability,
    HeadPose,
    Landmark,
)
from artloupe.persistence import (
    ArtistApiError,
    ArtistProject,
    ProjectNotFound,
    SourceImage,
    ToolResultKey,
)
from artloupe.schemas import TOOLS, CitedLesson, VisualFindings

PROJECT_ID = "aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa"
OWNER = "4a1f0e2c-0000-4000-8000-000000000001"
INTENT = {"medium": "oil", "time_budget_minutes": 90}

# Planted in the stand-in so a test can show it never reaches graph state.
SENTINEL_TOKEN = "sentinel-access-token-that-must-never-be-checkpointed"
# The recorded Director's provider key, planted for the same reason.
SENTINEL_API_KEY = "sk-ant-sentinel-key-that-must-never-be-checkpointed"


def drawn_photograph() -> bytes:
    """A 1200×800 JPEG with converging lines, so perspective has real structure to find."""
    canvas = np.full((800, 1200, 3), 210, dtype=np.uint8)
    for foot in range(0, 1201, 80):
        cv2.line(canvas, (600, 260), (foot, 799), (40, 40, 40), 3)
    cv2.rectangle(canvas, (80, 80), (380, 300), (110, 110, 110), -1)
    encoded_ok, encoded = cv2.imencode(".jpg", canvas)
    assert encoded_ok, "OpenCV could not encode the drawn photograph"
    return encoded.tobytes()


PHOTOGRAPH = drawn_photograph()
CHECKSUM = hashlib.sha256(PHOTOGRAPH).hexdigest()


def synthetic_face() -> DetectedFace:
    """A structurally valid face: 478 landmarks, a pose, a reliability, and every anchor.

    Geometrically meaningless — every landmark sits on one point — so it must never reach the
    Loomis construction. Tests that select head construction stub `head_from_face`.
    """
    point = Landmark(x=0.5, y=0.4, z=0.0)
    return DetectedFace(
        landmarks=[point] * 478,
        pose=HeadPose(
            yaw_deg=2.0,
            pitch_deg=-1.0,
            roll_deg=0.0,
            detector_yaw_deg=2.0,
            detector_pitch_deg=-1.0,
            detector_roll_deg=0.0,
        ),
        facial_landmark_reliability=FacialLandmarkReliability(
            yaw=1.0, pitch=1.0, scale=0.8, yaw_deg=2.0, pitch_deg=-1.0, face_height_px=150.0
        ),
        anchors=[
            Anchor(
                name=name, landmark=index, point=point, facing_deg=10.0, facing=1.0, reliability=0.8
            )
            for name, index in ANCHOR_LANDMARKS.items()
        ],
    )


def _metadata(tool: str, confidence: float | None) -> dict[str, Any]:
    return {
        "tool": tool,
        "tool_version": "test",
        "parameters": {},
        "source_checksum": CHECKSUM,
        "duration_ms": 12,
        "confidence": confidence,
        "limitations": [],
    }


FACE_GATE: dict[str, Any] = {
    "face_found": True,
    "reason": None,
    "facial_landmark_reliability": 0.8,
    "weakest": "scale",
    "face_height_px": 150.0,
}
NO_FACE_GATE: dict[str, Any] = {"face_found": False, "reason": "No face was found."}

# The survey node's output shape: the first-pass figures the Director reads.
SURVEY: dict[str, Any] = {
    "perspective": {
        "vanishing_points": 0,
        "confidences": [],
        "horizon_level_assumed": None,
        "metadata": _metadata("perspective", None),
    },
    "values": {
        "thresholds": [38.5, 61.0, 79.2, 90.4],
        "shares": [0.31, 0.22, 0.19, 0.17, 0.11],
        "metadata": _metadata("value_map", None),
    },
}


def decision(
    *, selected: list[str], declined: dict[str, str], rationale: str | None = None
) -> dict[str, Any]:
    """A Director's JSON answer: these tools selected, and these declined with these reasons."""
    return {
        "selected": [{"tool": tool, "reason": None} for tool in selected],
        "declined": [{"tool": tool, "reason": reason} for tool, reason in declined.items()],
        "rationale": rationale or "The value plates carry this plan, and the figures say why.",
    }


PERSPECTIVE_DECLINED = "no vanishing point cleared the 0.35 confidence floor"

# A portrait: the gate found a face, and the model declines perspective.
PORTRAIT_DECISION = decision(
    selected=[tool for tool in TOOLS if tool != "perspective"],
    declined={"perspective": PERSPECTIVE_DECLINED},
)
# No face: the model selects everything it was offered, which is every tool but the head.
EVERY_OFFERED_WITHOUT_A_FACE = decision(
    selected=[tool for tool in TOOLS if tool != "head_construction"], declined={}
)


def director_reply(
    answer: dict[str, Any] | str | None = None,
    *,
    model: str = "claude-opus-5",
    stop_reason: str = "end_turn",
    stop_details: dict[str, Any] | None = None,
    content: list[dict[str, Any]] | None = None,
    usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A Messages API response body carrying `answer` as the Director's JSON text.

    Adaptive thinking is on by default on Opus 5, and its text is omitted by default, so a reply
    opens with an empty thinking block before the answer.
    """
    if content is None:
        text = answer if isinstance(answer, str) else json.dumps(answer)
        content = [
            {"type": "thinking", "thinking": "", "signature": "signature-for-tests"},
            {"type": "text", "text": text},
        ]
    return {
        "id": "msg_recorded",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "stop_details": stop_details,
        "usage": {
            "input_tokens": 1800,
            "output_tokens": 240,
            "cache_read_input_tokens": 0,
            "cache_creation_input_tokens": 0,
            **(usage or {}),
        },
    }


# A reply computed from the request body, for an agent whose answer must name what it was sent.
Responder = Callable[[dict[str, Any]], dict[str, Any]]


class RecordedDirector:
    """A real `AsyncAnthropic` client whose transport answers from recorded replies, in order.

    Everything but the network is real: the SDK serialises the request and parses the reply as it
    would against the API. `requests` holds each request as it would have left this process.

    The Visual Analyst, the Studio Planner and the Plan Critic share the run's client with the
    Director, so a whole run's replies are queued here in call order (`whole_run`). A reply may be
    a `Responder`, called with the request body, when the answer has to name ids the request
    carried.
    """

    def __init__(self, *replies: dict[str, Any] | Responder) -> None:
        self.replies = list(replies)
        self.requests: list[httpx2.Request] = []
        self.client = AsyncAnthropic(
            api_key=SENTINEL_API_KEY,
            max_retries=0,
            http_client=DefaultAsyncHttpxClient(transport=httpx2.MockTransport(self._answer)),
        )

    def _answer(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        if not self.replies:
            return httpx2.Response(500, json={"error": "the test recorded no reply for this call"})
        reply = self.replies.pop(0)
        if callable(reply):
            reply = reply(json.loads(request.content))
        return httpx2.Response(200, json=reply)

    @property
    def bodies(self) -> list[dict[str, Any]]:
        return [json.loads(request.content) for request in self.requests]


def project_data(body: dict[str, Any]) -> dict[str, Any]:
    """The `<project_data>` JSON block of a request's user turn, decoded."""
    text = body["messages"][0]["content"]
    start = text.index("<project_data>") + len("<project_data>")
    return json.loads(text[start : text.index("</project_data>")])


def analyst_uses_everything(body: dict[str, Any]) -> dict[str, Any]:
    """The Visual Analyst's answer: every catalog entry used, quoting its tool."""
    catalog = project_data(body)["catalog"]
    return director_reply(
        {
            "findings": [
                {"finding_id": entry["finding_id"], "text": f"The {entry['tool']} measurement."}
                for entry in catalog
            ],
            "set_aside": [],
        }
    )


def claim(basis: str, source: str | None = None) -> dict[str, Any]:
    """A draft claim the Planner might write, resting on `basis`."""
    if basis == "choice":
        return {
            "text": "Start from the darkest shapes.",
            "basis": "choice",
            "source": None,
            "reason": "the darks carry the composition",
            "rejected_alternative": "starting from the outline",
        }
    return {
        "text": f"A claim resting on {source}.",
        "basis": basis,
        "source": source,
        "reason": None,
        "rejected_alternative": None,
    }


def plan_draft(*, finding: str, lesson: str, minutes: tuple[int, ...] = (60, 30)) -> dict[str, Any]:
    """A Planner's draft: one material, a stage per entry in `minutes`, every basis used once."""
    return {
        "assessment": {"suitability": "workable", "claims": [claim("finding", finding)]},
        "materials": [
            {
                "item_id": "brush",
                "category": "brush",
                "specification": "a medium hog-bristle filbert",
                "claim": claim("lesson", lesson),
            }
        ],
        "stages": [
            {
                "stage_id": f"stage-{index}",
                "title": f"Stage {index}",
                "minutes": length,
                "goal": "Mass the darks.",
                "completion_signal": "Every dark on the value plate has a mass.",
                "materials": ["brush"],
                "claims": [claim("choice")],
            }
            for index, length in enumerate(minutes, start=1)
        ],
        "self_check": ["Do the darks match the value plate?"],
    }


def planner_writes(minutes: tuple[int, ...] = (60, 30)) -> Responder:
    """The Planner's answer, citing the first finding and the first lesson it was sent."""

    def respond(body: dict[str, Any]) -> dict[str, Any]:
        data = project_data(body)
        return director_reply(
            plan_draft(
                finding=data["findings"][0]["finding_id"],
                lesson=data["lessons"][0]["lesson_id"],
                minutes=minutes,
            )
        )

    return respond


def critic_reply(
    verdict: str = "READY", defects: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    """The Plan Critic's answer."""
    return director_reply(
        {"defects": defects or [], "verdict": verdict, "summary": "The plan fits the budget."}
    )


def whole_run(decision: dict[str, Any], *after: dict[str, Any] | Responder) -> tuple:
    """Every model reply one run needs, in call order: Director, Analyst, Planner, Critic.

    `after` replaces the Planner's and the Critic's replies, for a run that revises its plan.
    """
    tail = after or (planner_writes(), critic_reply())
    return (director_reply(decision), analyst_uses_everything, *tail)


# One used finding, as the Visual Analyst reports it.
FINDINGS = VisualFindings.model_validate(
    {
        "findings": [
            {
                "finding_id": "value_map",
                "text": "A third of the photograph sits in the darkest value.",
                "evidence": {
                    "kind": "measured",
                    "tool": "value_map",
                    "tool_version": "test",
                    "parameters": {},
                    "source_checksum": CHECKSUM,
                    "units": "normalized",
                },
            }
        ],
        "set_aside": [],
    }
)
# One oil materials lesson, as the fixture source returns it.
LESSONS = [
    CitedLesson.model_validate(
        {
            "lesson_id": "fx-oil-materials",
            "topic": "materials",
            "title": "Oil",
            "text": "A limited palette covers most subjects.",
            "evidence": {
                "kind": "cited",
                "chunk_id": "fx-oil-materials",
                "institution": "Art Loupe fixture lessons",
                "url": "https://example.invalid/fixture-lessons/fx-oil-materials",
                "licence": "Fixture text written for development. Not a published source.",
                "retrieved_at": "2026-10-09T00:00:00Z",
                "passage_span": {"start": 0, "end": 40},
            },
        }
    )
]


# The plan half of a finished run's state, for suites that stub the graph rather than run it.
PLAN_STATE: dict[str, Any] = {
    "findings": {
        "findings": [
            {
                "finding_id": "value_map",
                "text": "Nearly a third of the photograph sits in the darkest value.",
                "evidence": {
                    "kind": "measured",
                    "tool": "value_map",
                    "tool_version": "test",
                    "parameters": {},
                    "source_checksum": CHECKSUM,
                    "units": "normalized",
                },
            }
        ],
        "set_aside": [],
    },
    "lessons": [],
    "plan": {
        "assessment": {
            "suitability": "workable",
            "claims": [
                {
                    "text": "The darkest value covers nearly a third of the frame.",
                    "evidence": {
                        "kind": "measured",
                        "tool": "value_map",
                        "tool_version": "test",
                        "parameters": {},
                        "source_checksum": CHECKSUM,
                        "units": "normalized",
                    },
                    "source": "value_map",
                }
            ],
        },
        "materials": [],
        "stages": [
            {
                "stage_id": "block-in",
                "title": "Block in the darks",
                "minutes": 90,
                "goal": "Mass the darkest value as one shape.",
                "completion_signal": "Every dark on the value plate has a mass.",
                "materials": [],
                "claims": [],
            }
        ],
        "self_check": ["Do the darks match the value plate?"],
    },
    "verdicts": [
        {
            "verdict": "READY_WITH_CAUTION",
            "defects": [
                {
                    "category": "missing_evidence",
                    "detail": "The stage rests on no finding, lesson or choice.",
                    "location": "block-in",
                    "origin": "check",
                }
            ],
            "summary": "Usable, with one stage resting on nothing.",
            "revision": 0,
        }
    ],
}


class Detector:
    """Stands in for `find_face`: counts calls and returns whatever `face` is set to."""

    def __init__(self) -> None:
        self.face: DetectedFace | None = None
        self.calls = 0

    def __call__(self, _image: Any, **_kwargs: Any) -> DetectedFace | None:
        self.calls += 1
        return self.face


class FakeArtistApi:
    """`ArtistApi`'s four calls, in memory, recording what was asked of it.

    Stored results go through a JSON round trip, because the real table stores JSON and a result
    that only survived as a live Python object would pass here and fail against Supabase.
    """

    def __init__(
        self,
        *,
        intent: dict[str, Any] | None = INTENT,
        photograph: bytes | None = PHOTOGRAPH,
        visible: bool = True,
    ) -> None:
        self.token = SENTINEL_TOKEN
        self.intent = intent
        self.photograph = photograph
        self.visible = visible
        self.fail_stores = False
        self.results: dict[ToolResultKey, dict[str, Any]] = {}
        self.downloads = 0
        self.lookups: list[ToolResultKey] = []
        self.stores: list[ToolResultKey] = []

    async def load_project(self, project_id: str) -> ArtistProject:
        if not self.visible or project_id != PROJECT_ID:
            raise ProjectNotFound(f"no project {project_id} is visible to this artist")
        source = None
        if self.photograph is not None:
            checksum = hashlib.sha256(self.photograph).hexdigest()
            source = SourceImage(
                checksum=checksum,
                storage_key=f"{OWNER}/{PROJECT_ID}/{checksum}",
                mime_type="image/jpeg",
                width_px=1200,
                height_px=800,
            )
        return ArtistProject(project_id=project_id, intent=self.intent, source=source)

    async def download_original(self, _source: SourceImage) -> bytes:
        self.downloads += 1
        assert self.photograph is not None
        return self.photograph

    async def find_tool_result(self, key: ToolResultKey) -> dict[str, Any] | None:
        self.lookups.append(key)
        return self.results.get(key)

    async def store_tool_result(self, key: ToolResultKey, result: Mapping[str, Any]) -> None:
        if self.fail_stores:
            raise ArtistApiError("Supabase refused to store a tool result as the artist: HTTP 503")
        self.stores.append(key)
        self.results.setdefault(key, json.loads(json.dumps(dict(result))))
