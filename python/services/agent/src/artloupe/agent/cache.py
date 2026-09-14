"""The read-through node cache over `public.tool_results` (routing-plan §4).

Two results are cached, and the choice is measured rather than general:

- **The face.** Every detection closes a MediaPipe landmarker, and every close sends Google a
  usage report (#43). Caching the face is what lets reopening a study send nothing, as
  `geometry-confidence-plan.md` §6 promises. A photograph with no face caches `None`, so it is
  not re-detected on every reopen either.
- **Perspective**, because the survey computes it and `analyse` reuses it.

Plates are not cached: a `PlateSuite` carries pixel arrays, does not serialize to JSON, and takes
under a second to recompute. Head construction is not cached: it takes about a millisecond from a
cached face.

The key is the FR-305 recipe — tool, `tool_version`, and a digest of the validated parameters —
scoped to the project. A library upgrade changes `tool_version`, so it is a miss rather than a
stale hit.
"""

import logging
from collections.abc import Mapping
from typing import Any

from artloupe.agent.resources import photograph, run_resources
from artloupe.image_tools import (
    DetectedFace,
    FaceDetectionParameters,
    PerspectiveParameters,
    PerspectiveResult,
    detect_perspective,
    find_face,
    head_tool_version,
)
from artloupe.image_tools.perspective import PERSPECTIVE_ALGORITHM_VERSION
from artloupe.image_tools.versioning import tool_version
from artloupe.persistence import ToolResultKey, parameters_digest

logger = logging.getLogger(__name__)

# The `tool` column's vocabulary. Named for what was run, not for a `ToolName`: the face is not a
# manifest tool, it is what the gate and head construction both rest on.
FACE = "face"
PERSPECTIVE = "perspective"


def _key(
    project_id: str, checksum: str, tool: str, version: str, parameters: Mapping[str, Any]
) -> ToolResultKey:
    return ToolResultKey(
        project_id=project_id,
        source_checksum=checksum,
        tool=tool,
        tool_version=version,
        parameters_digest=parameters_digest(parameters),
    )


async def _store(key: ToolResultKey, result: Mapping[str, Any]) -> None:
    """Cache a fresh result, and never fail the run for failing to.

    A lost cache row costs a recomputation — for the face, one more usage report — on the next
    reopen. Failing the artist's run to avoid that would be the wrong trade, the same one
    `artloupe.agent.runtime` declines for the metrics ledger.
    """
    try:
        await run_resources().api.store_tool_result(key, result)
    except Exception:
        logger.exception("failed to cache a tool result", extra={"tool": key.tool})


async def cached_face(project_id: str, checksum: str) -> DetectedFace | None:
    """The photograph's most prominent face, or `None` — detected at most once per recipe."""
    parameters = FaceDetectionParameters()
    key = _key(project_id, checksum, FACE, head_tool_version(), parameters.model_dump(mode="json"))

    hit = await run_resources().api.find_tool_result(key)
    if hit is not None:
        stored = hit["face"]
        return None if stored is None else DetectedFace.model_validate(stored)

    face = find_face(await photograph(project_id, checksum), parameters=parameters)
    await _store(key, {"face": None if face is None else face.model_dump(mode="json")})
    return face


async def cached_perspective(project_id: str, checksum: str) -> PerspectiveResult:
    """Vanishing points and the horizon, computed at most once per recipe."""
    parameters = PerspectiveParameters()
    key = _key(
        project_id,
        checksum,
        PERSPECTIVE,
        tool_version(PERSPECTIVE_ALGORITHM_VERSION),
        parameters.model_dump(mode="json"),
    )

    hit = await run_resources().api.find_tool_result(key)
    if hit is not None:
        return PerspectiveResult.model_validate(hit)

    result = detect_perspective(
        await photograph(project_id, checksum), source_checksum=checksum, parameters=parameters
    )
    await _store(key, result.model_dump(mode="json"))
    return result
