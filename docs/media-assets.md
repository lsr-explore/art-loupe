# Media assets — provenance & licensing

Third-party imagery and model files this repo commits or depends on. The same per-source
verdict discipline the retrieval corpus will use: nothing ships until its terms are read and
the verdict is written down here.

Verdict key: ✅ safe to commit and ship · ⚠️ conditions attached · ❌ do not commit.

| Asset | Source | Verdict | Terms honored |
| --- | --- | --- | --- |
| `apps/studio/public/portal-backdrop.jpg` | [Pexels](https://www.pexels.com/photo/serene-ocean-view-at-dusk-with-soft-waves-36457441/) — *Serene ocean view at dusk with soft waves*, Kostas Dimopoulos | ✅ Pexels License | Attribution optional, given anyway (below); no identifiable people in the frame; not resold, not redistributed as stock, not used as a mark |
| `fixtures/demo-images/pexels-dalia-nava-167975-7954434.jpg` | [Pexels](https://www.pexels.com/photo/view-of-gondolas-moored-on-the-sides-of-the-canal-in-murano-venice-italy-7954434/) — *View of Gondolas Moored on the Sides of the Canal in Murano, Venice, Italy*, dalia nava | ✅ Pexels License | Attribution given (below); unmodified original kept as a test and demo input, not redistributed as stock, not used as a mark |
| `fixtures/demo-images/pexels-tim-diercks-719708976-31589335.jpg` | [Pexels](https://www.pexels.com/photo/portrait-of-male-model-with-striped-sweater-31589335/) — *Studio portrait of a young male model in a striped sweater, Hamburg.*, Tim Diercks | ⚠️ Pexels License | An **identifiable person**: never shown unfavourably, and never identified or characterised (FR-802) — the sitter is a drawing reference, nothing more |
| `python/libs/image-tools/src/artloupe/image_tools/models/face_landmarker.task` (float16, version 1) | [MediaPipe models](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) — Google's face landmarker bundle | ✅ Apache 2.0 | Unmodified; the Apache 2.0 licence text is committed beside it as `models/LICENSE` and ships in the same wheel |

## `portal-backdrop.jpg`

- **Photographer:** Kostas Dimopoulos, via Pexels
- **Source URL:** <https://www.pexels.com/photo/serene-ocean-view-at-dusk-with-soft-waves-36457441/>
- **Original filename:** `pexels-kostas-dimopoulos-119583302-36457441.jpg`
- **License terms verified:** 2026-08-01 against <https://www.pexels.com/license/>.
  Free to use, commercial use allowed, **attribution not required**, modification allowed.
  Prohibited: showing identifiable people unfavourably · selling unaltered copies ·
  implying endorsement · redistributing on other stock platforms · use as a trade or
  service mark. The asset is a seascape with no people, ships as a decorative page
  backdrop, and is not resold — none of the prohibitions are engaged.
- **Attribution:** not required by the license; will eventually be added in the About site's
  Credits section. This file is the repo-side provenance
  record, not a substitute for that user-facing credit.

### Where it renders

The login screen today — see `apps/studio/src/components/auth/login-backdrop.tsx`, which
paints it at `opacity-75`. The signed-in portal surface that will also carry it is not
built yet. **Body text never composites over
the photograph**, which is a structural rule rather than a tuned opacity: measured against
the darkest composited pixel, `--muted-foreground` reads 1.13:1 at the settled 0.75 opacity
and only reaches 3.85:1 even at 0.15, so no opacity value in either theme satisfies WCAG
1.4.3. The panel carries `bg-background` and every descendant keeps the contrast the
[contrast gate](contrast-report/contrast.md) already verifies for it.

## `fixtures/demo-images/`

The two reference photographs the [e2e walkthrough](design/e2e-walkthrough.md) is built on —
run A (portrait) and run B (canal) — committed as unmodified originals so the demo, the
walkthrough, and tests all read the same bytes. Both carry an attribution in their EXIF
(`artist` / `copyright`); neither carries GPS or camera data.

| File | SHA-256 | Pixels |
| --- | --- | --- |
| `pexels-dalia-nava-167975-7954434.jpg` | `003fde582efcce54da2cf0793c0e594686506e8897de47efa44113cf5723ae8c` | 5040 × 3360 |
| `pexels-tim-diercks-719708976-31589335.jpg` | `8fe9582f197a30ad9ee4b3c7ee1bfff2a0af40ab6578d04482c391659ba22b72` | 4016 × 6016 |

- **Photographers:** dalia nava; Tim Diercks — both via Pexels.
- **License terms verified:** 2026-09-11 against <https://www.pexels.com/license/>, with the
  same terms recorded for `portal-backdrop.jpg` above. A public source repository is not a
  stock or wallpaper platform, so the redistribution prohibition is not engaged.
- **The portrait's condition.** The Pexels licence's only term about people is that they may
  not appear "in a bad light or in a way that is offensive". The product's own rule is
  stricter and applies here in full: FR-802 — no identity recognition, and no inference of
  sensitive traits from a face. Nothing in this repository names, describes, or characterises
  the sitter beyond quoting the photographer's own title as attribution.
- **Used by:** `python/libs/image-tools/tests/test_perspective_photographs.py` (canal and
  portrait), and the walkthrough's live demo uploads.

## `face_landmarker.task`

MediaPipe's face landmarker bundle, used by the face-landmark tool (slice 1 PR 10). It is
**committed**, unmodified, at `python/libs/image-tools/src/artloupe/image_tools/models/`, so the
tool, its tests and CI need no network to load it, and it ships in the `artloupe-image-tools`
wheel as package data. The directory's `README.md` repeats the provenance below.

| Field | Value |
| --- | --- |
| Source URL | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` — the **versioned** path, never `…/latest/…` |
| Size | 3,758,596 bytes |
| MD5 (base64) | `sOcnSQehZEQE/vZrKN1thQ==` |
| SHA-256 | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| Contents | `face_detector.tflite`, `face_landmarks_detector.tflite`, `face_blendshapes.tflite`, `geometry_pipeline_metadata_landmarks.binarypb` |

- **License terms verified:** 2026-09-11. The bundle carries no licence metadata of its own;
  the terms come from the three models' cards — the face detector, FaceMesh-V2, and the
  blendshape model — each **Apache 2.0**. The `mediapipe` library itself is also Apache 2.0.
- **Obligations:** used unmodified. Committing it is redistribution, so Apache 2.0's condition
  applies: the licence text is committed beside it as `models/LICENSE`, copied from the
  `mediapipe` 0.10.35 distribution's own licence file.

### What running it sends to Google

The model file sends nothing; the `mediapipe` runtime that loads it does
([#43](https://github.com/lsr-explore/art-loupe/issues/43)). Recorded here because the
obligation to disclose lands on this project, not on Google.

- **What.** MediaPipe's usage logging: which solution ran, session start and end, errors, and
  basic system information. This comes from the uploader compiled into the native library
  (`portable_clearcut_uploader.cc`), read from its strings rather than from a decoded payload.
  The payload itself could not be read: the uploader refuses a TLS-intercepting proxy's
  certificate even with that proxy's CA in the system trust store, so it validates against
  roots of its own or pins.
- **Where.** An HTTPS `POST` to `https://play.googleapis.com/log` (Google's Clearcut logging
  endpoint).
- **When.** Each time a face landmarker is closed — not while it is open, and not at import or
  model load. One upload is under 1 kB outbound including the TLS handshake: far too small to
  carry the photograph or the 478-point landmark set.
- **Opt-out.** None. No environment variable, API option or configuration file disables it in
  `mediapipe==0.10.35`. The only control is network egress from the process running detection.
- **Also installed.** `mediapipe` pulls in `sounddevice`, an audio-capture library. Nothing in
  this project imports it, and it does nothing unless imported; it is listed so the dependency
  is not a surprise.

Measured 2026-09-11 on linux/amd64 (`python:3.12-slim`) with a packet capture, and on
darwin/arm64 with per-process network counters.
