# artloupe-image-tools

The deterministic pixel tools the Studio Director selects (FR-301/302). Each reads a
photograph the artist supplied and returns geometry, measurement or a plate, plus FR-305
metadata. None generates imagery (FR-801): every pixel of a plate is a fixed function of the
artist's own photograph and its recorded parameters, and nothing in it is invented.

Two tools so far: **perspective** (PR 11), up to two vanishing points and the horizon through
them, each with a measured confidence; and the **plate suite** (PR 8), grayscale, a value map
and value contours from one pipeline.

## Perspective

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

### Confidence

Three signals, each scaled to `[0, 1]`, combined with `min` so the weakest decides:

| Signal | Low when | Scaled from |
| --- | --- | --- |
| `significance` | the point is a coincidence in clutter | supporting segments ÷ what chance predicts |
| `angular_fit` | the lines only roughly meet | mean angular residual ÷ inlier threshold |
| `support` | the point rests on a handful of lines | supporting segments ÷ 12 |

The raw measurements travel alongside the scaled ones. The scaling constants are judgements
calibrated on drawn scenes only; the interrupt threshold that sits on top of them is PR 13's.

## Plates

```python
from artloupe.image_tools import PlateParameters, make_plates

plates = make_plates(
    gray_or_bgr_uint8,
    source_checksum=source_image.checksum,
    parameters=PlateParameters.for_detail("coarse"),  # 3, 5 or 7 values
)
plates.grayscale.image            # uint8: each pixel's L*, colour dropped
plates.values.image               # uint8: each value as a flat grey
plates.values.thresholds          # the L* the values divide at — fitted, or supplied
plates.values.shares              # fraction of the photograph in each value, darkest first
for contour in plates.outline.contours:
    contour.level                 # the boundary between value `level - 1` and `level`
    contour.points                # normalized polyline; open where it meets the frame
    contour.edge_strength         # per segment: 0 a threshold through a gradient, 1 a hard edge
```

- **Lightness is CIELAB L\***, not luma — close to what a painter means by value.
- **Thresholds default to multi-level Otsu** on the photograph's own histogram, so a low-key
  portrait stays low-key. Equal-area thirds split the demo portrait's black ground at L\* 4 and
  5; equal L\* steps collapse its face into the dark value.
- **The outline traces the value map, not raw gradients**, so the two always correspond. A
  contour marks where lightness crosses a threshold, which on a soft gradient is not an edge in
  the photograph. `edge_strength` — the L\* gradient across it, on a log scale from
  `SOFT_EDGE_GRADIENT` to `HARD_EDGE_GRADIENT` — is how a consumer tells the two apart. It
  mixes contrast with abruptness: a faint hard edge and a strong soft one can measure alike.
- **Deterministic plates state no confidence** — `None`, which is a different claim from `0.0`.

## Invariants

- **One `cv2` provider: `opencv-contrib-python`.** It is what `mediapipe` (PR 10) depends on.
  Never add `opencv-python` — both install `cv2`, uv resolves the pair silently, and the
  loser breaks at import. `tests/test_dependency_hygiene.py` fails if a second appears
  anywhere in the workspace.
- **The input is already oriented.** Decode with EXIF applied, or every point lands on the
  wrong spot of the photograph the artist sees.
- **The recipe reproduces the result.** Every tool's `tool_version` comes from
  `versioning.tool_version` and carries the OpenCV and NumPy versions, because either can move
  the output. Perspective's RANSAC is seeded from `PerspectiveParameters.seed`.
- **Every contour point lies on an edge of the value map.** `tests/test_plates.py` asserts it
  on drawn scenes and `tests/test_plates_photographs.py` on both demo photographs; an
  independent edge detector would pass every other plate test.
- **CI needs `libgl1 libglib2.0-0`** for the non-headless `cv2`.
