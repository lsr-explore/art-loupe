"""Stand-ins for the agent's suites: the artist's Supabase data, a photograph, and a face.

Not `conftest.py`, for the reason `libs/persistence/tests/db_support.py` gives: this workspace
already has a root `conftest.py`, so importing from a module named `conftest` depends on
collection order. The fixtures stay in `conftest.py`; the things a test names live here.

**No MediaPipe anywhere in these suites.** A real detection closes a landmarker, and every close
sends Google a usage report (#43). The detector is tested where it lives, in `libs/image-tools`.
Here it is replaced by `synthetic_face()` — a *valid* `DetectedFace`, so the cache's JSON round
trip is exercised for real rather than around a mock.
"""

import hashlib
import json
from collections.abc import Mapping
from typing import Any

import cv2
import numpy as np

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

PROJECT_ID = "aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa"
OWNER = "4a1f0e2c-0000-4000-8000-000000000001"
INTENT = {"medium": "oil", "time_budget_minutes": 90}

# Planted in the stand-in so a test can show it never reaches graph state.
SENTINEL_TOKEN = "sentinel-access-token-that-must-never-be-checkpointed"


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
