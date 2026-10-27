"""Fixtures for the agent's suites. What they stand in for is explained in `agent_support.py`."""

import os
import socket
from ipaddress import ip_address
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


@pytest.fixture(autouse=True)
def isolate_model_configuration(monkeypatch):
    """Wire-contract tests use recorded transports; runtime-mock tests explicitly select mock."""
    monkeypatch.setenv("LLM_MODE", "live")
    for name in tuple(os.environ):
        if name.startswith("AI_MODEL_") or (
            name.startswith("ARTLOUPE_") and name.endswith("_MODEL")
        ):
            monkeypatch.delenv(name)


@pytest.fixture(autouse=True)
def block_external_model_network(monkeypatch):
    """A second backstop beyond CI's key refusal: only local test services may use sockets."""
    from artloupe.config import running_in_ci

    if os.environ.get("ARTLOUPE_LIVE_TESTS") == "1" and not running_in_ci():
        return
    connect = socket.socket.connect
    connect_ex = socket.socket.connect_ex
    resolve = socket.getaddrinfo

    def local(host):
        if host in {"localhost", b"localhost", None}:
            return True
        try:
            return ip_address(host).is_loopback
        except ValueError:
            return False

    def checked_connect(sock, address):
        if sock.family != socket.AF_UNIX and not local(address[0]):
            raise RuntimeError("External model network access is disabled in tests")
        return connect(sock, address)

    def checked_connect_ex(sock, address):
        if sock.family != socket.AF_UNIX and not local(address[0]):
            raise RuntimeError("External model network access is disabled in tests")
        return connect_ex(sock, address)

    def checked_resolve(host, *args, **kwargs):
        if not local(host):
            raise RuntimeError("External model DNS access is disabled in tests")
        return resolve(host, *args, **kwargs)

    monkeypatch.setattr(socket.socket, "connect", checked_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", checked_connect_ex)
    monkeypatch.setattr(socket, "getaddrinfo", checked_resolve)
