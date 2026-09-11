# artloupe-image-tools

The deterministic pixel tools the Studio Director selects (FR-301/302). Each reads a
photograph the artist supplied and returns geometry or measurement plus FR-305 metadata —
never imagery (FR-801).

Slice 1 PR 11 adds the first tool, **perspective**: up to two vanishing points and the
horizon through them, each with a measured confidence.

```python
from artloupe.image_tools import detect_perspective

result = detect_perspective(gray_or_bgr_uint8, source_checksum=source_image.checksum)
for vp in result.vanishing_points:
    vp.point.x, vp.point.y        # overlay-normalized, NOT clamped — often off-frame
    vp.confidence.value           # min of the three signals below
    vp.confidence.weakest         # which one decided — what an interrupt should name
result.horizon                    # None when nothing was found
result.metadata                   # ArtifactMetadata: the recipe that reproduces this
```

## Confidence

Three signals, each scaled to `[0, 1]`, combined with `min` so the weakest decides:

| Signal | Low when | Scaled from |
| --- | --- | --- |
| `significance` | the point is a coincidence in clutter | supporting segments ÷ what chance predicts |
| `angular_fit` | the lines only roughly meet | mean angular residual ÷ inlier threshold |
| `support` | the point rests on a handful of lines | supporting segments ÷ 12 |

The raw measurements travel alongside the scaled ones. The scaling constants are judgements
calibrated on drawn scenes only; the interrupt threshold that sits on top of them is PR 13's.

## Invariants

- **One `cv2` provider: `opencv-contrib-python`.** It is what `mediapipe` (PR 10) depends on.
  Never add `opencv-python` — both install `cv2`, uv resolves the pair silently, and the
  loser breaks at import. `tests/test_dependency_hygiene.py` fails if a second appears
  anywhere in the workspace.
- **The input is already oriented.** Decode with EXIF applied, or every point lands on the
  wrong spot of the photograph the artist sees.
- **The recipe reproduces the result.** RANSAC is seeded from `PerspectiveParameters.seed`,
  and `tool_version` carries the OpenCV version, because LSD's output can move between
  releases.
- **CI needs `libgl1 libglib2.0-0`** for the non-headless `cv2`.
