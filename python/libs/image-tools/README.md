# artloupe-image-tools

The deterministic pixel tools the Studio Director selects (FR-301/302). Each reads a
photograph the artist supplied and returns geometry, measurement or a plate, plus FR-305
metadata. None generates imagery (FR-801): every pixel of a plate is a fixed function of the
artist's own photograph and its recorded parameters, and nothing in it is invented.

Three tools so far: **perspective** (PR 11), up to two vanishing points and the horizon through
them, each with a measured confidence; the **plate suite** (PR 8), grayscale, a value map and
value contours from one pipeline; and **head construction** (PR 10), face landmarks and a Loomis
construction fitted to them, with a derived reliability.

## Perspective

```python
from artloupe.image_tools import detect_perspective

result = detect_perspective(gray_or_bgr_uint8, source_checksum=source_image.checksum)
for vp in result.vanishing_points:
    vp.point.x, vp.point.y        # overlay-normalized, NOT clamped — often off-frame
    vp.confidence.value           # min of the three signals below
    vp.confidence.weakest         # which one decided — what an interrupt should name
    vp.segments                   # the detected segments converging on it — its evidence
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

- **Weak candidates are held back.** A point below `PerspectiveParameters.min_confidence` —
  0.35 by default — is not reported, and the limitations count what was held back. The floor
  is a parameter: lower it, or set it to 0 to see every candidate.
- **The evidence travels with each point.** `vp.segments` are the lines that converge on it, so
  a correction screen can draw them — and let the artist toggle them — rather than a bare point.

## Plates

```python
from artloupe.image_tools import PlateParameters, make_plates

plates = make_plates(
    gray_or_bgr_uint8,
    source_checksum=source_image.checksum,
    parameters=PlateParameters.for_detail("finest"),  # 3, 5 (default), 7 or 10 values
)
plates.grayscale.image            # uint8: each pixel's L*, colour dropped
plates.values.image               # uint8: each value as a flat grey
plates.values.thresholds          # the L* the values divide at — fitted, or supplied
plates.values.shares              # fraction of the photograph in each value, darkest first
for contour in plates.value_shapes.contours:
    contour.level                 # the boundary between value `level - 1` and `level`
    contour.points                # normalized polyline; open where it meets the frame
    contour.edge_strength         # per segment: 0 a threshold through a gradient, 1 a hard edge
for chain in plates.outline.chains:
    chain.points                  # normalized polyline; two points when `straight`
    chain.straight                # a run the fitter claimed straight, rather than traced pixels
    chain.from_shadow_pass        # found only with the shadows gamma-expanded
    chain.edge_strength           # per segment, same units and scale as a value contour
```

- **Two to ten values, five by default.** The presets are coarse (3, FR-301's three-value
  study), medium (5), fine (7) and finest (10, a painter's full value scale); the metadata names
  the plate `value_map`.
- **Lightness is CIELAB L\***, not luma — close to what a painter means by value.
- **Thresholds default to multi-level Otsu** on the photograph's own histogram, so a low-key
  portrait stays low-key. Equal-area thirds split the demo portrait's black ground at L\* 4 and
  5; equal L\* steps collapse its face into the dark value.
- **Value shapes trace the value map, not raw gradients**, so the two always correspond, and
  more values give them more to trace. A contour marks where lightness crosses a threshold, which
  on a soft gradient is not an edge in the photograph. `edge_strength` — the L\* gradient across
  it, on a log scale from `SOFT_EDGE_GRADIENT` to `HARD_EDGE_GRADIENT` — is how a consumer tells
  the two apart. It mixes contrast with abruptness: a faint hard edge and a strong soft one can
  measure alike.
- **The outline is the other line layer, and it answers a different question.** It traces edges
  in a texture-flattened copy and fits long straight runs as true straight lines, so buildings
  come out straight and windows rectangular where value contours wander. The cost is the mirror
  image: an edge detector needs a gradient, and a boundary of about 2 L\* or less has none to
  find. On the demo portrait — ground L\* 3.5, jacket 5.4, hair 4.8 — the outline loses the
  silhouette and the value-shapes layer still carries it. **Neither layer replaces the other**,
  which is why both ship.
- **`flatten` chooses the filter**, and it is a time-for-cleanliness trade measured on the canal
  at 1024 px: `domain_transform` (278 ms, the default), `domain_transform_fast` (111 ms),
  `bilateral_texture` (523 ms, suppresses the most), `none`. The default is the default because
  its cost does not depend on the picture; the L0 smoothing this replaced ranged from 0.7 s to
  8.6 s on the same two photographs.
- **`shadow_gamma` runs a second pass over expanded shadows** and recovers part of what the first
  misses in the dark — set it to 1.0 to turn the pass off. A chain it found is flagged
  `from_shadow_pass`, because a boundary recovered from near the noise floor is a weaker claim
  than one the photograph stated plainly. **The expansion happens before flattening, and the
  order is the point:** flattening is what erases a low-contrast boundary, so gamma applied
  afterwards has nothing left to lift. Getting it backwards cost the demo portrait's shadowed
  eye entirely.
- **A straight run is a fit, not a measurement.** Its two points are where the fitted line ends,
  not pixels traced in the photograph, and the metadata says so.
- **Deterministic plates state no confidence** — `None`, which is a different claim from `0.0`.

## Head construction

```python
from artloupe.image_tools import NormalizedPoint, construct_from_face, construct_head

result = construct_head(bgr_uint8, source_checksum=source_image.checksum)
result.face                       # None when no face is found — the portrait gate's answer
reliability = result.face.facial_landmark_reliability
reliability.value                 # derived: min of yaw, pitch and scale below
reliability.weakest               # which one decided — what an interrupt should name
result.face.pose                  # framing-corrected yaw, pitch, roll, and the detector's own
for anchor in result.face.anchors:        # brow, nose, chin, right_side, left_side
    anchor.point, anchor.facing_deg, anchor.reliability
for element in result.construction.elements:
    element.name, element.claim   # "measured" through the sitter's landmarks, or "chosen" scaffold
    element.points                # normalized polyline, unclamped
result.metadata.confidence        # the face's reliability; its limitations say it is derived

# FR-403/404: an artist-corrected anchor recomputes the construction; depth stays the detector's
construct_from_face(result.face, width=w, height=h,
                    corrections={"chin": NormalizedPoint(x=0.51, y=0.83)})
```

The design is [`docs/design/loomis-construction.md`](../../../docs/design/loomis-construction.md);
the reliability's is [`docs/design/geometry-confidence-plan.md`](../../../docs/design/geometry-confidence-plan.md) §3.

### Reliability — derived, not detected

MediaPipe reports no confidence, so this one is derived from the conditions the observation was
made under, never from the face, and named `facial_landmark_reliability` rather than
"confidence". Signals combine with `min`:

| Signal | Low when | Scaled from |
| --- | --- | --- |
| `yaw`, `pitch` | the head is turned or nodded | framing-corrected angle: 1 at 15° or less, 0 at 60° |
| `scale` | the face covers few source pixels | forehead to chin: 1 at 170 px or more, 0 at 64 px |
| an anchor's `facing` | its surface is turned away from the camera | angle to the camera: 1 up to 90°, 0 at 120° |

- **Pose is corrected for framing.** The detector reads a face high in the frame as nodding, and
  one to the side as turned. The pose is rotated to the line of sight through the face
  (`FRAMING_VFOV_DEG`, calibrated on the fixtures), which removes nearly all of that from pitch,
  and from yaw on a turned head. On a near-frontal face it over-corrects yaw, by about 5° at the
  frame's edge. That leaves the score unchanged, since yaw's reliability is full below 15°. The
  detector's own angles travel beside the corrected ones.
- **Ratios are measurements, never scores.** The construction reports brow-to-nose and
  nose-to-chin; nothing flags a face for departing from the method's ideal thirds.
- **Every landmarker close sends Google a usage report** (#43). One is opened per call by
  default; share one with `open_landmarker(parameters)`, as the tests do.
- **Small faces are not found at all** — below about 15–18% of the frame's height (#45).

## Invariants

- **One `cv2` provider: `opencv-contrib-python`.** It is what `mediapipe` depends on. Never add
  `opencv-python` — both install `cv2`, uv resolves the pair silently, and the loser breaks at
  import. `tests/test_dependency_hygiene.py` fails if a second appears anywhere in the
  workspace.
- **`mediapipe` is pinned to `0.10.35`**, because `1.x` hard-aborts on darwin/arm64. The model
  ships as package data in `models/`, with its Apache 2.0 licence beside it.
- **The input is already oriented.** Decode with EXIF applied, or every point lands on the
  wrong spot of the photograph the artist sees. For head construction, pass the full-resolution
  original too: the scale signal counts source pixels.
- **The recipe reproduces the result.** Every tool's `tool_version` comes from
  `versioning.tool_version` and carries the OpenCV and NumPy versions; head construction adds
  the `mediapipe` version and a digest of the model. Perspective's RANSAC is seeded from
  `PerspectiveParameters.seed`.
- **Results reload from JSON exactly.** Computed fields are written for readers and derived
  again on reload, so a stored result is read back, never recomputed and never trusted blindly.
- **Every contour point lies on an edge of the value map.** `tests/test_plates.py` asserts it
  on drawn scenes and `tests/test_plates_photographs.py` on both demo photographs; an
  independent edge detector would pass every other plate test.
- **CI needs `libgl1 libglib2.0-0 libgles2 libegl1`** — the first pair for the non-headless
  `cv2`, the second for the face model at load time.
