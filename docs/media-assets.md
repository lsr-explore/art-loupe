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
| `fixtures/face-poses/pexels-geezy-photography-325144321-13767162.jpg` | [Pexels](https://www.pexels.com/photo/en-face-portrait-of-woman-with-neutral-expression-13767162/) — *En Face Portrait of Woman with Neutral Expression*, Geezy Photography | ⚠️ Pexels License | An **identifiable person**: a pose fixture only, never identified or characterised (FR-802) |
| `fixtures/face-poses/pexels-minan1398-1070745.jpg` | [Pexels](https://www.pexels.com/photo/photography-of-a-woman-looking-at-camera-1070745/) — *Photography of a Woman Looking at Camera*, Min An | ⚠️ Pexels License | An **identifiable person**: a pose fixture only, never identified or characterised (FR-802) |
| `fixtures/face-poses/pexels-anh-nguyen-517648218-20867428.jpg` | [Pexels](https://www.pexels.com/photo/portrait-of-a-man-in-a-dark-room-20867428/) — *Portrait of a Man in a Dark Room*, Anh Nguyen | ⚠️ Pexels License | An **identifiable person**: a pose fixture only, never identified or characterised (FR-802) |
| `fixtures/face-poses/pexels-roma-durkin-125803188-10963932.jpg` | [Pexels](https://www.pexels.com/photo/black-and-white-portrait-of-woman-turning-head-to-look-at-camera-10963932/) — *Black and White Portrait of Woman Turning Head to Look at Camera*, Roma Durkin | ⚠️ Pexels License | An **identifiable person**: a pose fixture only, never identified or characterised (FR-802) |
| `fixtures/face-poses/pexels-cottonbro-9892782.jpg` | [Pexels](https://www.pexels.com/photo/side-view-of-a-woman-face-9892782/) — *Side View of a Woman Face*, cottonbro studio | ⚠️ Pexels License | An **identifiable person**: a pose fixture only, never identified or characterised (FR-802) |
| `fixtures/face-poses/pexels-ba-tik-3754266.jpg` | [Pexels](https://www.pexels.com/photo/side-view-photo-of-man-3754266/) — *Side view portrait of a handsome bearded man with long hair wearing a pink shirt against a neutral background.*, Ba Tik | ⚠️ Pexels License | An **identifiable person**: a pose fixture only, never identified or characterised (FR-802) |
| `fixtures/face-poses/pexels-anderson-santos-883070-14086522.jpg` | [Pexels](https://www.pexels.com/photo/close-up-portrait-of-a-bearded-man-14086522/) — *Side view portrait of a gray-haired man against a black background in a studio setting.*, Anderson Santos | ⚠️ Pexels License | An **identifiable person**: a pose fixture only, never identified or characterised (FR-802) |
| `fixtures/face-poses/pexels-reneterp-325685.jpg` | [Pexels](https://www.pexels.com/photo/full-length-portrait-of-man-standing-in-corridor-325685/) — *Full Length Portrait of Man Standing in Corridor*, Rene Terp | ⚠️ Pexels License | An **identifiable person**: a pose fixture only, never identified or characterised (FR-802) |
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

## `fixtures/face-poses/`

Pose fixtures for the face-landmark tool (slice 1 PR 10): faces turned, tilted, close and far.
They were chosen by measuring each candidate with the detector itself rather than by eye, and
are committed as **Pexels' own 1400 px renditions**
(`https://images.pexels.com/photos/<id>/pexels-photo-<id>.jpeg?auto=compress&cs=tinysrgb&w=1400`),
not the full-size originals — unaltered by this project, and eight of them come to 1.5 MB.

| File | SHA-256 | Pixels | Measured by the detector |
| --- | --- | --- | --- |
| `pexels-geezy-photography-325144321-13767162.jpg` | `c5baf98903f99c99b12d90c4b589f7c1418e778b9bac76362520228589f2ed1c` | 1400 × 1750 | yaw 1.5°; landmarks span 0.88 of the height |
| `pexels-minan1398-1070745.jpg` | `5fd0ef55140614a958508d7e27ab09e7058116849d3f306a634c56d6131347b8` | 1400 × 1400 | yaw −3.6°, roll 31° |
| `pexels-anh-nguyen-517648218-20867428.jpg` | `758415956ac3867a0bc6f6e580078ffe9216104c7ba49ca02581fca34fbef436` | 1400 × 1750 | yaw 17.7° |
| `pexels-roma-durkin-125803188-10963932.jpg` | `de2a8957b929c4c4199bf74d7b870bcc585fdeb1260b7c7af3ac6b36c29680e5` | 1400 × 2100 | yaw −35.9° |
| `pexels-cottonbro-9892782.jpg` | `84c817cae045c2741743d7ba5255c5071fdb7dcc0d11bfd946ea68e12f828cff` | 1400 × 933 | yaw 37.6° (reads as about 60°) |
| `pexels-ba-tik-3754266.jpg` | `1936074155074786c5f66837f166fb90e10e0084e41f96e5ecbc9ea3f9e620b8` | 1400 × 1901 | yaw 56.6° (reads as 70–80°) |
| `pexels-anderson-santos-883070-14086522.jpg` | `43123545d10a65e7b559b7bbe31b3ed961280c50a2f5e77d040e77703c1eda99` | 1400 × 933 | no face — a true profile |
| `pexels-reneterp-325685.jpg` | `2197f410c03451895ae44706874c754fe25a3679c23433fe21e72ef6fef7ae39` | 1400 × 2100 | no face — too small in a full-length frame |

- **Photographers:** Geezy Photography; Min An; Anh Nguyen; Roma Durkin; cottonbro studio; Ba
  Tik; Anderson Santos; Rene Terp — all via Pexels.
- **License terms verified:** 2026-09-11 against <https://www.pexels.com/license/>, the same
  terms recorded for `portal-backdrop.jpg` above. A public source repository is not a stock or
  wallpaper platform, so the redistribution prohibition is not engaged.
- **The condition.** Every file shows an identifiable person, so FR-802 applies to each exactly
  as it does to the demo portrait: no identity recognition, no inference of sensitive traits,
  and nothing in this repository names, describes or characterises a sitter beyond quoting the
  photographer's own title as attribution.
- **Metadata.** None carries GPS or camera data, or an ICC profile. `pexels-cottonbro-9892782.jpg`
  carries `Artist` and `Copyright` tags and `pexels-anderson-santos-883070-14086522.jpg` a
  `Copyright` tag — the photographers' own.
- **Crops are cut in code.** The full-length photograph's face is too small to detect; tests cut
  crops of it at run time to find the detector's small-face limit, so no cropped file is
  committed.
- **Used by:** the face-landmark tool's tests (slice 1 PR 10).

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
- **Tests and CI.** The face tool's tests run the detector, so every local and CI test run sends
  uploads too — one per landmarker closed.
- **Opt-out.** None. No environment variable, API option or configuration file disables it in
  `mediapipe==0.10.35`. The only control is network egress from the process running detection.
- **Also installed.** `mediapipe` pulls in `sounddevice`, an audio-capture library. Nothing in
  this project imports it, and it does nothing unless imported; it is listed so the dependency
  is not a surprise.

Measured 2026-09-11 on linux/amd64 (`python:3.12-slim`) with a packet capture, and on
darwin/arm64 with per-process network counters.
