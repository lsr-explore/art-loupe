"""Private, reproducible PNG studies. No derivative bytes enter graph checkpoints."""

import asyncio
from typing import Literal
from uuid import UUID

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from artloupe.agent.cache import cached_face, cached_perspective
from artloupe.agent.resources import RunResources, decode_original, use_run_resources
from artloupe.auth.dependencies import CurrentUser, HttpClient
from artloupe.image_tools import head_from_face, make_plates
from artloupe.persistence import ArtistApi

router = APIRouter()
Tool = Literal[
    "grayscale", "value_map", "value_shapes", "outline", "perspective", "head_construction"
]


def draw_path(canvas, points, *, closed=False, color=(40, 40, 40)):
    """Clip segments at the image boundary without moving off-frame geometry onto it."""
    height, width = canvas.shape[:2]
    pixels = [(round(p.x * width - 0.5), round(p.y * height - 0.5)) for p in points]
    pairs = list(zip(pixels, pixels[1:], strict=False))
    if closed and pixels:
        pairs.append((pixels[-1], pixels[0]))
    thickness = max(1, round(max(width, height) / 700))
    for start, end in pairs:
        # Limit only numeric range for OpenCV's signed integer arguments, not image coordinates.
        start = tuple(max(-1_000_000_000, min(1_000_000_000, n)) for n in start)
        end = tuple(max(-1_000_000_000, min(1_000_000_000, n)) for n in end)
        visible, start, end = cv2.clipLine((0, 0, width, height), start, end)
        if visible:
            cv2.line(canvas, start, end, color, thickness, cv2.LINE_AA)


def encode_png(image):
    ok, data = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("PNG encoding failed")
    return data.tobytes()


def render_plate(image, checksum, tool):
    plates = make_plates(image, source_checksum=checksum)
    if tool == "grayscale":
        return encode_png(plates.grayscale.image), plates.grayscale.metadata
    if tool == "value_map":
        return encode_png(plates.values.image), plates.values.metadata
    canvas = np.full((*plates.grayscale.image.shape, 3), 255, dtype=np.uint8)
    paths = plates.value_shapes.contours if tool == "value_shapes" else plates.outline.chains
    for path in paths:
        draw_path(canvas, path.points, closed=path.closed)
    return encode_png(canvas), (
        plates.value_shapes.metadata if tool == "value_shapes" else plates.outline.metadata
    )


@router.get("/projects/{project_id}/artifacts/{tool}")
async def artifact_image(
    project_id: UUID,
    tool: Tool,
    user: CurrentUser,
    client: HttpClient,
    version: str | None = Query(default=None, max_length=512),
    checksum: str | None = Query(default=None, max_length=64),
):
    """Read the project as its artist on every request, including after deletion or sign-out."""
    api = ArtistApi(user.access_token, client=client)
    project = await api.load_project(str(project_id))
    if project.source is None:
        raise HTTPException(status_code=404, detail="Reference not found.")
    source = project.source
    if checksum is not None and checksum != source.checksum:
        raise HTTPException(status_code=409, detail="The reference recipe has changed.")
    data = await api.download_original(source)
    image = await asyncio.to_thread(decode_original, data, checksum=source.checksum)
    with use_run_resources(RunResources(api=api, image=image)):
        if tool in {"grayscale", "value_map", "value_shapes", "outline"}:
            png, metadata = await asyncio.to_thread(render_plate, image, source.checksum, tool)
        else:
            canvas = image.copy()
            if tool == "perspective":
                result = await cached_perspective(str(project_id), source.checksum)
                metadata = result.metadata
                for point in result.vanishing_points:
                    for segment in point.segments:
                        draw_path(canvas, [segment.start, segment.end], color=(255, 220, 0))
                if result.horizon:
                    draw_path(
                        canvas, [result.horizon.left, result.horizon.right], color=(0, 220, 255)
                    )
            else:
                face = await cached_face(str(project_id), source.checksum)
                height, width = image.shape[:2]
                head = head_from_face(
                    face, width=width, height=height, source_checksum=source.checksum
                )
                metadata = head.metadata
                if head.construction:
                    for element in head.construction.elements:
                        color = (255, 220, 0) if element.claim == "measured" else (0, 220, 255)
                        draw_path(canvas, element.points, closed=element.closed, color=color)
            png = await asyncio.to_thread(encode_png, canvas)
    if version is not None and version != metadata.tool_version:
        raise HTTPException(status_code=409, detail="This study requires a different tool version.")
    return Response(
        png,
        media_type="image/png",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'inline; filename="{tool}.png"',
            "X-Content-Type-Options": "nosniff",
        },
    )
