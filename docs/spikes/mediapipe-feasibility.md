# Spike — MediaPipe feasibility for PR 10

**Date:** 2026-09-05 · **Branch:** `spike/mediapipe-feasibility` · **Status:** complete

Retires the largest unretired risk in the back half of the slice-1 ladder before PR 10 depends
on the answer. Everything below was measured, not read off a changelog: a scratchpad venv on
darwin/arm64 and a `python:3.12-slim` container on `linux/amd64`, both running
`face_landmarker` against `docs/temp-references/tim-diercks-portrait/01-original-reference.jpg`.

## Verdict

MediaPipe is viable and the plan's stated dependency risk is retired — but **pin `0.10.35`**,
and the plan's confidence assumption does not hold.

## What was measured

| Question | Answer |
| --- | --- |
| py3.12 wheel, darwin arm64 | Yes — wheels are `py3-none-<platform>`, so Python-version agnostic |
| py3.12 wheel, linux x86_64 (CI) | Yes — `manylinux_2_28_x86_64` |
| Fights `numpy>=2`? | No. Resolves to `numpy==2.5.2` on both platforms |
| protobuf / jax pins | **Gone.** Neither appears in the resolution at all |
| `.task` model | 3,758,596 bytes (3.58 MB), HTTP 200, no auth |
| Outputs | 478 landmarks, 52 blendshapes, 4×4 transformation matrix |
| Speed | detect 13 ms (M1 Pro) / 74 ms (emulated linux); model load 0.3–1.2 s |
| Cross-platform determinism | **Identical coordinates** on macOS and Linux |

## Four findings that change the plan

### 1. Pin `mediapipe==0.10.35`. Do not take `1.x`

`1.0.1` **hard-aborts** on darwin/arm64 before returning a result:

```
F0000 graph_service.h:139] Check failed: service_ Service is unavailable.
    @ -[DrishtiMetalHelper initWithCalculatorContext:]
    @ mediapipe::api2::TensorsToDetectionsCalculator::Open()
```

`TensorsToDetectionsCalculator` initialises the Metal helper unconditionally, so forcing
`delegate=CPU` does **not** avoid it. It is an `abort()`, not a Python exception — it cannot be
caught, and it takes the interpreter with it. `0.10.35` (2026-04-27) runs clean on the same
machine.

Caveat if anything ever runs on arm64 Linux: `0.10.35` ships no `manylinux aarch64` wheel;
`1.x` does. Irrelevant for GitHub's x86_64 runners.

### 2. CI needs system libraries, or it fails at load time

On `python:3.12-slim`, two distinct failures before any test runs:

- `import cv2` → missing `libGL.so.1`
- `FaceLandmarker.create_from_options` → `OSError: libGLESv2.so.2: cannot open shared object file`

Working set: `libgl1 libglib2.0-0 libgles2 libegl1`. Verify against `ubuntu-latest` rather than
assuming — the failure mode is an unhandled `OSError` at model load, which reads like a broken
model file rather than a missing OS package.

### 3. `opencv-python` must never be added — this is a PR 10 / PR 11 constraint

`mediapipe` depends on **`opencv-contrib-python`**. Adding `opencv-python` for PR 11's Hough/LSD
work puts both in the environment:

```
opencv-contrib-python==5.0.0.93
opencv-python==5.0.0.93
```

Both ship the `cv2` namespace, and **uv resolves the pair with no error**. The breakage is
silent and arrives at import time. PR 11 must use the `cv2` that `mediapipe` already provides,
or drop `mediapipe` and take `opencv-python` alone — never both. This is the one place where
running PRs 10 and 11 in parallel can produce a conflict no reviewer would see in either diff.

### 4. `face_landmarker` exposes **no** confidence value

The plan says confidence "must be real, because they drive the interrupt." The library does not
provide one:

```
result fields: ['face_blendshapes', 'face_landmarks', 'facial_transformation_matrixes']
landmark fields: [..., 'presence', 'visibility', 'x', 'y', 'z']
landmark visibility: None    presence: None
options exposing confidence: ['min_face_detection_confidence',
                              'min_face_presence_confidence', 'min_tracking_confidence']
```

Per-landmark `visibility` and `presence` are `None`. The three `min_*_confidence` settings are
**input thresholds**, not output scores — nothing reports the score actually achieved.

What still works unchanged: the plan's deterministic portrait gate. "≥1 face" is binary,
reliable, and free, so FR-307's routing decision stays off the LLM as designed.

What does not: any confidence *number* attached to the face path has to be **derived**, and
that derivation is a design decision, not an implementation detail. The design landed in
[`../design/geometry-confidence-plan.md`](../design/geometry-confidence-plan.md); this file
records only that the detector supplies no such number.

An earlier draft of this section listed *landmark dispersion against expected Loomis
proportions* among the candidates. That signal has since been **withdrawn** — it measures a
sitter's conformity to an idealized template rather than the detector's uncertainty, and would
have fired the FR-402 interrupt more often the further a face sat from that ideal. See §3 of
the plan for why, and do not reintroduce it from this file.

## Open

**The `.task` model's licence is unconfirmed.** The `mediapipe` library is Apache 2.0 (repo
`LICENSE` verified). The model bundle is a separate artifact from
`storage.googleapis.com/mediapipe-models/`, and its FaceMesh-V2 model card is a scanned PDF
with no extractable text; the solutions page links the card but states no terms. Treat this as
open until someone reads the card, not as settled by the library's licence.
