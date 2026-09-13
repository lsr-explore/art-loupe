# Where generated imagery is allowed, and where it is not

**Design note, not a decision record.** The direction is chosen — generated imagery may be a
labelled alternative, never the measured source — but it is not settled enough to commit to an
ADR, and nothing here has been applied to `requirements.md`. When it settles, this becomes one.

- **Direction chosen:** 2026-09-13, Laurie Reynolds
- **Tracked by:** the tickets under [Follow-ups](#follow-ups)

## Context

FR-801 (P0) reads *"Zero image generation. No provider image endpoint is reachable from any graph
node,"* asserted in CI as a build-time reachability check. `README.md` frames the value of that
wording precisely: it keeps *"never generates"* **structurally verifiable rather than a policy
promise**. FR-807 turns it outward — the acknowledgement gate must tell an artist *we never
generate art* before they can upload.

That rule was written against a specific empirical finding. Four generated "coloring book" plates
across two vendors were compared to a deterministic transform, and all four failed on the axes
that matter for an underdrawing: **omission** (people at café tables dropped, boats dropped),
**invented type** (signage rendered as clean legible text the model could not have read),
**likeness loss** (no vendor preserved the sitter), and **value loss** (a navy sweater on a
near-black ground rendered white). The deterministic suite served the artist better, so the
generative backend was dropped and FR-801 stood.

Two things since have made the rule's wording, rather than its intent, the problem.

**It is stricter than the intent.** FR-801 as phrased bans machine learning that produces
imagery, but the commitment underneath it is about **invented pixels**. Art Loupe already ships a
neural network — MediaPipe `face_landmarker` — and it has never violated anything, because its
output is landmarks. Verified 2026-09-13: the only import is
`mediapipe.tasks.python.vision.FaceLandmarker`; the wheel's `mediapipe.tasks.genai` submodule is
LLM model-bundling tooling and is not referenced anywhere in this repo.

**It is looser than the intent in one place.** "Zero image generation" says nothing about a model
being asked to *classify* or *select* among deterministic candidates, which is a different act
with a different failure mode.

Meanwhile the deterministic outline shipped (#60) and its limits are now measured, not assumed:
it needs a gradient, so a boundary of about **2 L\*** or less is invisible to it. On the demo
portrait the silhouette it misses is ground L\* 3.5 against jacket 5.4 and hair 4.8.

## The boundary

**The line is invented pixels, not machine learning.** FR-801 is amended to say so, and gains a
boundary rather than a prohibition:

1. **Forbidden, unchanged:** generating a full image, and adding elements to an image.
2. **Permitted:** a **generated outline**, offered as a **labelled alternative** to the measured
   one — never as its replacement, and never as the source of a `measured` claim.
3. **Permitted, and not generation:** a discriminative model whose output is not pixels —
   landmarks, labels, masks used only for *selection*. This is what MediaPipe already does.
4. **Out of scope and unplanned:** removing an element from the reference photograph and filling
   the vacated region. Laurie, 2026-09-13 — *"an artist may want to remove the entire left side
   and have it be open water… This is not planned, so we don't need a ticket or to consider it
   now."* Recorded so the boundary is legible, not to schedule it.

**The measured outline remains the default and the only basis for measurement.** Invented
geometry cannot carry a `measured` claim and cannot reproduce from an FR-305 recipe, so anything
resting on registration or measurement rests on the deterministic layers.

## Rationale

The claim taxonomy decides this. Every claim is `measured` | `cited` | `chosen`, and a generated
outline is none of them: it is not a pixel fact, it has no instructional source, and it is not a
human artistic call. Rather than add a fourth class to the spine, the generated outline is kept
**out of the claim graph** — it is an artifact an artist may choose to trace, labelled as such,
and no plan sentence cites it as evidence.

A reversal worth recording. A review note proposed splitting into two products, a "registration
overlay" and an interpretive "planning guide", and that was **argued against** on 2026-09-13:
per-*claim* labelling is strictly stronger than per-*product* labelling, because one artifact can
carry both, line by line, without forcing a mode choice. That reasoning held while generation was
banned. Once a model may draw an outline, it stops holding — invented geometry cannot be labelled
line-by-line against the photograph, because there is no photograph fact behind each line. Two
artifacts making two different promises is then the honest structure, and the split becomes
necessary rather than redundant.

## Alternatives considered

- **Keep FR-801 as written.** Rejected: it already forbids something the repo does (MediaPipe),
  so the rule is unenforceable as literally phrased, and the CI check passes only because the
  check is about provider *endpoints* rather than about machine learning.
- **Make the generated outline the primary.** Rejected: it would make the invented artifact the
  thing artists actually trace, moving the authorship and reproducibility questions onto the main
  path instead of an opt-in one.
- **Add a fourth claim class** for model-derived assertions. Rejected for now — it changes a
  load-bearing spine and every consumer of it, to serve an artifact that is deliberately outside
  the claim graph.

## Consequences

- **FR-801's structural guarantee weakens from "no endpoint is reachable" to "no endpoint is
  reachable from the measured path."** That is a genuinely weaker property: it can no longer be
  asserted by a whole-repo reachability check alone, and needs a test that the deterministic
  plate path reaches no vendor.
- **FR-807's gate copy changes.** The commitment is no longer *we never generate art*; it becomes
  a statement of what is generated, what is measured, and an opt-out. Laurie's plan is to show
  the difference on the Pexels demo images so the choice is concrete rather than abstract.
- **[#59](https://github.com/lsr-explore/art-loupe/issues/59) stops being conditional.** Its
  provider record — provider, exact model, version, terms version, retention, training use,
  indemnification, redistribution — becomes required rather than hypothetical.
- **A fidelity harness stops being optional.** Disclosing honestly what a generated outline gets
  wrong means measuring it: unsupported-line rate, major-object recall, landmark displacement.
- **The copyright story needs stating, not just the terms.** An artist tracing a generated
  intermediate needs to know what they can claim. Purely AI-generated material attracts no
  copyright protection; their own marks and creative modifications may.
- **The deterministic work is unaffected and still the default**, so #60's two layers, #54's
  omission check and #55's line-type classification all stand as written.

## Follow-ups

Tracked as issues, not as a list here: [#63](https://github.com/lsr-explore/art-loupe/issues/63) amends FR-801 and FR-807 to this boundary, and [#64](https://github.com/lsr-explore/art-loupe/issues/64) is the generated outline itself.

Two are field changes on existing issues rather than new work:
[#59](https://github.com/lsr-explore/art-loupe/issues/59) was filed P3 on the strength of being
conditional and that condition is now met, and
[#56](https://github.com/lsr-explore/art-loupe/issues/56) gains the opt-out.

The vendor choice is untouched here. A **discriminative** edge model
(`cv2.ximgproc.createStructuredEdgeDetection`, or an ONNX HED/PiDiNet through `cv2.dnn`) falls
under clause 3 rather than clause 2 — no vendor, no terms surface, no deletion-boundary hole —
so it is worth exhausting before any of the generative machinery is built.

## Related

- [`requirements.md`](./requirements.md) — FR-101, FR-105, FR-305, FR-801, FR-804, FR-807
- [`slice-1-build-plan.md`](./slice-1-build-plan.md) — the empirical finding that produced FR-801
- [ADR 0003](../decision-records/0003-project-deletion-holds-the-artist-token.md) — the deletion
  boundary a vendor copy would sit outside
- Epic [#57](https://github.com/lsr-explore/art-loupe/issues/57) — the artist-facing policy work
  this decision feeds
