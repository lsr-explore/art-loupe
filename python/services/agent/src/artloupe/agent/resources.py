"""What a run holds that must never enter its state.

`RunState` is checkpointed, so anything in it is written to Postgres on every superstep and kept
for as long as the checkpoint is. Three things a run needs therefore live beside the state rather
than in it:

- **The artist's bearer token**, inside an `ArtistApi`. In a checkpoint it would outlive its own
  expiry, readable by anything that can read the checkpoint schema.
- **The decoded photograph.** An original can be 25 MB before decoding (FR-101); written into
  every checkpoint, it would dwarf everything else the run stores.
- **The Director's model client**, which holds the provider API key. In a checkpoint, the key would
  be readable by anything that can read the checkpoint schema, for as long as the checkpoint is.

Both travel in a `ContextVar`, the way `artloupe.metering` carries its recorder: asyncio tasks
inherit the context they were created in, so every node sees the resources without the graph
carrying them, and nothing about them reaches LangGraph's `config`.

When PR 13 resumes a run in a different process, the photograph is simply absent here, and
`photograph()` fetches it again. That is correct rather than merely tolerable: the bytes are
immutable under FR-105, and the checksum in the state says which bytes they must be.
"""

import hashlib
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

import cv2
import numpy as np
from anthropic import AsyncAnthropic
from numpy.typing import NDArray

from artloupe.image_tools import PlateSuite
from artloupe.persistence import ArtistApi


class PhotographUnavailable(RuntimeError):
    """The original could not be read as the photograph its checksum names."""


@dataclass
class RunResources:
    """One run's token-bearing client, its Director client, and what it has fetched and computed.

    Mutable on purpose: `load_project` decodes the photograph once and every later node reuses it,
    and the survey's plates are reused by `analyse` rather than computed twice.

    `director` is shared across runs, since it is one connection pool per process. It travels here
    rather than in the state because it holds the provider key.
    """

    api: ArtistApi
    director: AsyncAnthropic | None = None
    image: NDArray[np.uint8] | None = None
    plates: PlateSuite | None = None


_RESOURCES: ContextVar[RunResources | None] = ContextVar("artloupe_run_resources", default=None)


@contextmanager
def use_run_resources(resources: RunResources) -> Iterator[RunResources]:
    """Make `resources` the active run's for everything run inside this block."""
    token = _RESOURCES.set(resources)
    try:
        yield resources
    finally:
        _RESOURCES.reset(token)


def run_resources() -> RunResources:
    """The active run's resources. A node that reads artist data cannot run without them."""
    resources = _RESOURCES.get()
    if resources is None:
        raise RuntimeError(
            "this node reads the artist's data and ran outside a run's resources; start runs "
            "through artloupe.agent.runtime.execute_run"
        )
    return resources


def decode_original(data: bytes, *, checksum: str) -> NDArray[np.uint8]:
    """The original as a BGR array in its displayed orientation — once it is proven to be it.

    The checksum is checked before anything is decoded. FR-105 makes the checksum the identity
    every artifact cites, so bytes that do not hash to it are not this project's photograph,
    whatever the storage key says.

    `cv2.imdecode` applies EXIF orientation, as `cv2.imread` does. That was probed rather than
    assumed, on OpenCV 5.0 with an Orientation=6 JPEG: stored 20×40, decoded 40×20. Every tool
    requires an EXIF-oriented input, and a wrongly oriented one would land every coordinate on
    the wrong spot of the photograph the artist sees.
    """
    if hashlib.sha256(data).hexdigest() != checksum:
        raise PhotographUnavailable(
            "the downloaded original does not match the project's recorded checksum (FR-105)"
        )
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise PhotographUnavailable("the original could not be decoded as an image")
    return image


async def photograph(project_id: str, checksum: str) -> NDArray[np.uint8]:
    """The run's photograph: decoded at most once per process, fetched again after a resume."""
    resources = run_resources()
    if resources.image is None:
        project = await resources.api.load_project(project_id)
        if project.source is None or project.source.checksum != checksum:
            raise PhotographUnavailable("the project's original is not the one this run began on")
        data = await resources.api.download_original(project.source)
        resources.image = decode_original(data, checksum=checksum)
    return resources.image
