# Geometry and confidence — plan for slice-1 PRs 10, 11, 12

**Status:** proposed · **Date:** 2026-09-05 · **Supersedes nothing**

Written from measured results in [`../spikes/mediapipe-feasibility.md`](../spikes/mediapipe-feasibility.md).
`slice-1-build-plan.md` remains the ladder. This document proposes changes to *how* PRs 10-12
are built and, in §5, to *the order* as well. Every recommendation below is a proposal — the
naming call in §3 and the ordering call in §5 are Laurie's.

## 1. Dependency policy — three rules, all load-bearing

### Pin `mediapipe==0.10.35` exactly

Not `>=`, not `~=`. `1.x` aborts the interpreter on darwin/arm64 inside
`TensorsToDetectionsCalculator` and cannot be caught or configured around. An unpinned upper
bound means the next `uv sync` on a clean machine can produce a dev environment where every
face test dies with a stack trace and no Python frame. The pin needs a comment saying so, or
someone will "tidy" it to a range.

### Exactly one `cv2` provider, and it is `opencv-contrib-python`

`mediapipe` depends on it transitively. PR 11 must not add `opencv-python`: both distributions
install the same `cv2` namespace, and **uv resolves the pair without error**, so the breakage
is silent and arrives at import time in whichever module loses the race.

This is the only way PRs 10 and 11 can break each other while both diffs look correct, so it
should be enforced rather than remembered:

```python
# python/libs/<vision-pkg>/tests/test_dependency_hygiene.py
from importlib.metadata import distributions

def test_exactly_one_cv2_provider() -> None:
    providers = {
        dist.metadata["Name"]
        for dist in distributions()
        if dist.metadata["Name"] in {"opencv-python", "opencv-contrib-python",
                                     "opencv-python-headless", "opencv-contrib-python-headless"}
    }
    assert providers == {"opencv-contrib-python"}, (
        f"expected only opencv-contrib-python (mediapipe's), found {providers}. "
        "Two distributions both install cv2 and uv resolves them without error."
    )
```

### CI installs the GL libraries explicitly

`libgl1 libglib2.0-0 libgles2 libegl1`. Do not rely on `ubuntu-latest` happening to carry
them. The failure without them is `OSError: libGLESv2.so.2: cannot open shared object file`
raised from `create_from_options` — it reads like a corrupt model file, and someone will spend
an afternoon re-downloading a `.task` that was never the problem.

## 2. The confidence problem, stated precisely

`slice-1-build-plan.md` requires confidence values that are **real**, because they drive the
FR-402 interrupt. The two geometry paths are not symmetric, and the plan currently treats them
as if they were:

| Path | Confidence available? |
| --- | --- |
| Lines / vanishing points (PR 11) | **Yes, genuinely measured.** Support above chance, angular residual of the fit, and count of supporting segments all fall out of the estimation itself |
| Face landmarks (PR 10) | **No.** `visibility` and `presence` are `None`; the `min_*_confidence` options are input thresholds, and nothing reports the score achieved |

So PR 11 can report a measured confidence. PR 10 cannot, and must derive one.

PR 11 combines its three signals with `min`, the same rule §3 sets for the face path. Its
first signal is support measured **against chance**, not a plain RANSAC inlier ratio: among
enough unrelated segments some point always collects agreement by coincidence, and on drawn
clutter a ratio-based signal scored those phantoms level with real one-point structure.
Measured against chance, drawn clutter lands at 3-12× and drawn structure at 17-60×.
Photographs are harder: the Murano canal's real convergence on the bridge is 9×, level with
drawn clutter, and scores 0.42. So the signal ranks points well, but no threshold separates
real from coincidental on photographs by construction — PR 13 has to set one against them.
The package README (`python/libs/image-tools/README.md`) carries the definitions.

## 3. Derive a *facial landmark reliability* score, and do not call it confidence

The honest framing matters more than the arithmetic here. A number derived from face geometry
is not the model's probability that it found a face; it is our assessment of whether the
landmarks are in a configuration a Loomis construction can be trusted on. Calling that
`confidence` invites every later reader to treat it as a detector output.

**Name: `facial_landmark_reliability`** (Laurie, 2026-09-11). Face-specific on purpose: PR 11's
perspective number stays `confidence`, because it is measured by the fit itself, and the two
must never read as the same kind of claim. Rejected: `geometric_plausibility` (too generic) and
`facial_landmark_alignment` — in computer vision "face alignment" *is* landmark localization, so
it would read as a fit-quality claim the detector cannot support, and it does not cover scale.

**It also fills `ArtifactMetadata.confidence`** (Laurie, 2026-09-11) — the shared FR-305 field
that FR-401's "per-feature confidence" wording points at — so the interrupt reads one field for
every tool. Filling the field does not change the claim: the artifact's `limitations` carry a
string saying the value is derived from head pose and face scale, not a detector score, and the
result exposes it under its own name, `facial_landmark_reliability`, beside its components.

### Two independent signals, combined with `min`, not a product or a mean

Each is a distinct failure mode, cheap, and explainable to an artist. The scaling is Laurie's
(2026-09-11), set against eight pose fixtures measured with the detector itself
([`../media-assets.md`](../media-assets.md)):

1. **Pose extremity** — yaw and pitch from the 4×4 facial transformation matrix, each 1 at a
   measured 15° or less and 0 at 45°, linear between. A Loomis construction degrades as the
   head turns or nods, because the far-side landmarks are then extrapolated rather than
   observed. The thresholds are on *measured* angles, which flatten at steep turns: a
   near-profile the eye reads as 70–80° measures 56.6°, and a three-quarter view that reads as
   60° measures 37.6°. **Roll is excluded** — a tilt within the picture hides no landmark, the
   detector corrects for it, and the construction simply rotates with the head.
2. **Scale** — the face's height in *source pixels*, 1 at 170 px or more and 0 at 64 px. The
   mesh model resizes each face crop, with a 25% margin on every side, to 256 px (FaceMesh-V2
   model card), so below about 170 px of face its landmarks are placed on upsampled pixels. A
   share of the frame would say little: the bundled detector finds no face whose landmarks span
   less than about 15–18% of the frame height at all.

Both measure the **conditions the observation was made under**, not the face. That distinction
is the constraint on adding a third.

### The signal that was proposed here and has been withdrawn

An earlier draft added *proportional plausibility* — measured ratios (inter-ocular distance to
face height, eye line to chin) compared against the Loomis proportions the overlay is about to
assert, with a large deviation read as a bad mesh fit.

**That is wrong, and wrong in a way worth naming rather than quietly deleting.** Loomis
proportions are an artistic idealization, not a description of how faces are. A face detected
perfectly whose natural proportions sit far from that ideal would score low — so the signal
does not measure fit quality at all, it measures *conformity to a norm*. Combined with `min`,
which lets the weakest signal decide, it would have controlled the score outright.

The consequence is concrete: the FR-402 interrupt would fire more often the further a sitter's
anatomy sits from an idealized template, asking the artist to "correct" landmarks that were
accurately observed. Proportion varies with ancestry, age and individual difference, so the
faces flagged most often would not be a random sample. That is a fairness defect wearing a
confidence score, and it sits directly against the commitment `requirements.md` §9 is being
amended to make explicit about identity and sensitive-trait inference.

Symmetry residual is **not** the fix either, for the same reason one layer down: facial
asymmetry is ordinary, and `slice-1-build-plan.md` already records losing "the stubble, the
mole, and the facial asymmetry" as what made generative plates unusable. A signal penalising
asymmetry would discard exactly what the product exists to help an artist see.

**So the recommendation is two signals, not three.** A third may be added later if one can be
found that measures the *detector's* uncertainty rather than the *sitter's* face — internal
mesh degeneracy is a candidate worth investigating. Until then, two honest signals beat three
where one encodes a norm.

**Combine with `min`.** These are independent ways for the guide to be wrong, so the weakest
signal is what determines whether the artist should be asked. A mean lets two good signals
mask one bad one, which is the exact case the interrupt exists to catch. `min` also stays
explainable: the interrupt can say *which* signal fired, which FR-402's correction UI needs
anyway.

`min` is also why the bar for adding a signal is high. Whatever is weakest **controls** the
score, so a signal that is wrong in some population is not diluted by the others — it decides.

### Consequences for the claim taxonomy

The resulting number is `measured` under §6's closed union — it is computed from pixels, with
no real-world unit, so FR-306 is not at risk. Its provenance should name the contributing components
rather than presenting one opaque scalar, so a `chosen` threshold sitting on top of it stays
auditable.

## 4. What does not change

The deterministic portrait gate stands exactly as `slice-1-build-plan.md` specifies. "≥1 face
detected" is binary, free, and reliable, so FR-307's routing decision stays off the LLM and the
critical path stays deterministic. Nothing in this document moves a decision to a model.

Cross-platform golden tests are also now viable and should be used: landmark coordinates were
**bit-identical** between darwin/arm64 and linux/amd64, so a fixture asserting exact landmark
values will hold in CI rather than needing a tolerance.

## 5. Suggested ordering change — PR 11 before PR 10

The ladder has 10 then 11, on the reasoning that 10 isolates the dependency risk. **That risk
is now retired**, which removes 10's claim to going first, and 11 has become the better
opener:

- PR 11's confidence is real, so the interrupt threshold in PR 12 can be designed against a
  genuine distribution before a derived score is layered beside it.
- PR 11 has no unresolved design question; PR 10 has §3 open until the naming and combination
  are approved.
- PR 11 establishes the vision package and therefore owns the `opencv-contrib-python`
  dependency and the §1 hygiene test, which is exactly the ordering that makes the clash
  impossible rather than merely documented.

## 6. Open

- **The pinned build sends usage metrics to Google every time a landmarker closes**
  ([#43](https://github.com/lsr-explore/art-loupe/issues/43)), and this blocks PR 10 merging,
  not writing it. The native library compiles in a Clearcut uploader
  (`portable_clearcut_uploader.cc`, endpoint `play.googleapis.com/log`) carrying MediaPipe's
  solution-invocation events. Captured on linux/amd64 (`python:3.12-slim`, 2026-09-11): a
  landmarker held open for 130 seconds after one detection sent nothing while open, then made
  one HTTPS upload the moment it closed — about 0.9 kB out and 4.2 kB in, to
  `play.googleapis.com` (`172.217.118.4:443`). In one process that created, used and closed a
  fresh landmarker every five seconds, **every close uploaded**: 25 closes, 25 uploads, each
  within 0.1 s of its close. No switch turns it off — no environment variable, no Python
  option, no state file. The payload could not be read: the uploader rejects an intercepting
  proxy's certificate (`tlsv1 alert unknown ca`) even with the proxy's CA in the system trust
  store, so it carries its own roots or pins. What it sends is known from the library's
  strings, not from a decoded request.
- **A new landmarker per call, with its result stored** (Laurie, 2026-09-11). Because the
  upload is triggered by `close()`, that is one upload per photograph analysed — and since face
  detection is also the portrait gate, that means every photograph uploaded, not only
  portraits. The result is reloaded rather than recomputed: PR 10 makes it round-trip through
  JSON exactly, and PR 12's checksum-keyed cache stores it with the study, so reopening a study
  sends nothing. One landmarker per process would send fewer, and was not chosen. Not
  measured: whether a landmarker held open past 130 seconds flushes on a timer, and what a
  process killed without `close()` sends — both matter less when each landmarker closes within
  its call.
- **The user-facing disclosure** is drafted in
  [`../about-site/data-sent-to-google.md`](../about-site/data-sent-to-google.md), for a page
  linked from the About site, which is not built yet.
- **The model licence is settled** — Apache 2.0, in [`../media-assets.md`](../media-assets.md).
- **`0.10.35` ships no `manylinux aarch64` wheel** (`1.x` does). Irrelevant on GitHub's x86_64
  runners; relevant the day anything targets arm64 Linux.
