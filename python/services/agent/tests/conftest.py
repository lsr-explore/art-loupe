"""Fixtures for the agent's suites. What they stand in for is explained in `agent_support.py`."""

from types import SimpleNamespace
from typing import Any

import pytest
from agent_support import CHECKSUM, Detector, FakeArtistApi

from artloupe.image_tools import DetectedFace
from artloupe.schemas import ArtifactMetadata


@pytest.fixture
def api() -> FakeArtistApi:
    """One artist's project, with an intake and a drawn photograph."""
    return FakeArtistApi()


@pytest.fixture
def detector(monkeypatch: pytest.MonkeyPatch) -> Detector:
    """Replace MediaPipe for the test. It finds no face unless `detector.face` is set."""
    stub = Detector()
    monkeypatch.setattr("artloupe.agent.cache.find_face", stub)
    return stub


@pytest.fixture
def head_construction(monkeypatch: pytest.MonkeyPatch) -> list[DetectedFace | None]:
    """Replace the Loomis construction, which a synthetic face cannot support. Records its faces."""
    faces: list[DetectedFace | None] = []

    def construct(face: DetectedFace | None, **_kwargs: Any) -> SimpleNamespace:
        faces.append(face)
        return SimpleNamespace(
            metadata=ArtifactMetadata(
                tool="head_construction",
                tool_version="test",
                parameters={},
                source_checksum=CHECKSUM,
                duration_ms=0,
                confidence=0.8,
                limitations=[],
            )
        )

    monkeypatch.setattr("artloupe.agent.nodes.head_from_face", construct)
    return faces
