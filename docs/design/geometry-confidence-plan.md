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
| Lines / vanishing points (PR 11) | **Yes, genuinely measured.** RANSAC inlier ratio, angular residual of the fit, and count of supporting segments all fall out of the estimation itself |
| Face landmarks (PR 10) | **No.** `visibility` and `presence` are `None`; the `min_*_confidence` options are input thresholds, and nothing reports the score achieved |

So PR 11 can report a measured confidence. PR 10 cannot, and must derive one.

## 3. Recommendation — derive a *geometric plausibility* score, and do not call it confidence

The honest framing matters more than the arithmetic here. A number derived from face geometry
is not the model's probability that it found a face; it is our assessment of whether the
landmarks are in a configuration a Loomis construction can be trusted on. Calling that
`confidence` invites every later reader to treat it as a detector output.

**Proposed name: `geometric_plausibility`.** This is a naming call and therefore Laurie's — but
whatever it is called, it should not be the same word PR 11 uses for a real inlier ratio.

### Three independent signals, combined with `min`, not a product or a mean

Each is a distinct failure mode, cheap, and explainable to an artist:

1. **Pose extremity** — yaw, pitch and roll extracted from the 4×4 facial transformation
   matrix. A Loomis construction degrades as the head turns, because past roughly 35° of yaw
   the far-side landmarks are extrapolated rather than observed.
2. **Scale** — face bounding-box height as a fraction of image height. On a small face,
   per-landmark pixel error dominates the proportions being measured.

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

- **The `.task` model's licence is unconfirmed.** The library is Apache 2.0; the model bundle is
  a separate artifact whose FaceMesh-V2 model card is a scanned PDF with no extractable text,
  and the solutions page states no terms. This should be resolved before PR 10 merges, not
  before it starts — it does not block writing the code, only shipping it.
- **`0.10.35` ships no `manylinux aarch64` wheel** (`1.x` does). Irrelevant on GitHub's x86_64
  runners; relevant the day anything targets arm64 Linux.
