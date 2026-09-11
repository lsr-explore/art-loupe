# Loomis head construction — from landmarks to an artist-correctable overlay

**Status:** designed, 2026-09-11; slice 1 PR 10 builds it. One scaling in §8 is still open.

FR-302 asks for a head-construction overlay "from facial landmarks plus our own SVG geometry,
artist-correctable". The landmarks come from MediaPipe's face landmarker; this document is
the "our own geometry" half — what the construction consists of, which parts are measured on
the photograph and which are drawn from the method, and how the artist corrects it.

## 1. The method, as far as this document relies on it

Andrew Loomis's construction (*Drawing the Head and Hands*, 1956) builds a head from a ball
for the cranium, with a flat plane sliced from each side. A **centre line** runs down the
front of the ball and the face; horizontal lines across it mark the **brow**, the **base of
the nose** and the **chin**, and the method divides the face into three roughly equal units
— hairline to brow, brow to nose, nose to chin. The ear sits on the side plane, between the
brow line and the nose line. Because every line wraps around a ball, the construction turns
with the head: that is what makes it useful for a head seen at an angle.

**The ball's proportions are a chosen default, not a quoted rule.** Its size is set from the
measured brow-to-nose unit, times a factor fixed by eye against the pose fixtures and recorded
as a judgement — a **chosen** claim, which the taxonomy labels rather than cites. A sourced
value, once the retrieval corpus carries one (`retrieval.md`, where *Loomis* is the worked
example for the sparse leg), replaces the default without changing the output's shape.

## 2. Measured, and chosen

Every element is one of the two claim kinds the project already uses. A line through a
landmark the detector placed is **measured**; a part of the scaffold the photograph cannot
show is **chosen**, drawn from the method, and labelled as such.

| Element | Anchored on (MediaPipe landmark index) | Claim | In PR 10 |
| --- | --- | --- | --- |
| Centre line | the facial midline, 10 → 151 → 9 → 168 → 6 → 1 → 2 → 0 → 17 → 152 | measured | yes |
| Brow line | 9, between the brows; across the head through the brow ends 70 and 300 | measured | yes |
| Nose line | 2, the base of the nose | measured | yes |
| Chin line | 152, the bottom of the chin | measured | yes |
| Eye line | the outer eye corners, 33 and 263 | measured | yes |
| Cranial ball | sized from the brow-to-nose unit by a chosen factor | **chosen** | yes |
| Side plane | an ellipse on the ball's side, turned with the head | **chosen** | yes |
| Hairline | one unit above the brow line | **chosen** | later |
| Ear | on the side plane between brow and nose lines, its front edge near 234 / 454 | **chosen**, placed near a measured point | later |
| Jaw | from below the ear to the chin, through 172 / 397 | measured points, **chosen** curve | later |

The indices were checked by eye on two fixtures, not taken from a reference: on the frontal
close-up, 9 sits between the brows, 168 on the bridge at eye level, 2 at the base of the nose
and 152 at the bottom of the chin; on the near-profile, 234 lands at the front of the ear.

## 3. The ideal is a scaffold, never a verdict

The method's even thirds are an idealisation, and a sitter's face is not wrong for departing
from them. This is the same line `geometry-confidence-plan.md` §3 draws when it withdraws the
proportional-plausibility signal, and it binds the construction too:

- **Measured lines go where the sitter's features are**, not where the thirds say they should
  be. A long nose gets a long middle unit.
- **Ratios are reported as measurements only** — "brow to nose is 1.2 times nose to chin" is a
  measured claim an artist can use. Nothing scores, flags or interrupts on a ratio, because
  that would be conformity to a template dressed as a finding, and FR-802 forbids
  characterising a face.
- **Chosen parts are drawn from the measured ones**, never the reverse: the ball is sized from
  the measured brow-to-nose unit, not the brow placed from an assumed ball.

## 4. Posing it in 3D, without a camera model

Landmarks carry depth. MediaPipe's own definition: "`x` and `y` are normalized to `[0.0, 1.0]`
by the image width and height respectively. `z` represents the landmark depth with the depth
at center of the head being the origin, and the smaller the value the closer the landmark is to
the camera. The magnitude of `z` uses roughly the same scale as `x`." Measured on the frontal
close-up, the nose tip sits nearest (−310 px) and the sides of the face farthest (+587 and
+634 px) — the shape a head should have.

So the construction is fitted in landmark space, in pixels (`x·W`, `y·H`, `z·W`):

1. **A head frame from the landmarks themselves** — up along the centre line (152 → 10), across
   from 234 to 454, and depth as their cross product.
2. **Each line is a section of the ball in that frame** — the brow line is the circle where the
   plane through 9, perpendicular to "up", cuts the ball; the nose and chin lines likewise
   through 2 and 152. Sampled as points, they curve around the head as it turns.
3. **Projected by dropping depth**, back to the overlay's normalized coordinates.

That last step is orthographic: it assumes the head is far from the lens relative to its own
depth. A close, wide-angle selfie breaks it, and that is a stated limitation rather than a
modelled camera — MediaPipe's transformation matrix would need a camera model this path avoids.

## 5. Correction (FR-403, FR-404)

The artist corrects **anchors**, not lines. The draggable anchors are the measured points the
construction is fitted to — 9, 2 and 152 down the middle, 234 and 454 at the sides — and every
element is recomputed from them. That matches fascia's existing primitives: a handle is a
point with keyboard, pointer and non-drag paths, and a line follows its ends. A corrected
anchor is persisted as an artist-authored fact (FR-403) and everything downstream recomputes
(FR-404).

## 6. What the result carries

A pydantic model in `image-tools`, as `PerspectiveResult` is — a schema contract waits until
the agent and the studio need to exchange it (PR 12/13):

- the 478 landmarks, normalized, with `z`;
- the pose (yaw, pitch, roll) and the face's height in source pixels;
- `facial_landmark_reliability` with its components and the one that decided (plan §3), also
  filling `ArtifactMetadata.confidence` with the derived-limitation string;
- the five anchors by name, each with its own reliability (§8);
- each element as a named, sampled polyline with its claim kind, and the chosen ball factor in
  the recorded parameters;
- or, when no face is found, a no-face result carrying the declination reason the portrait
  gate gives (a turned-away head, or a face below the detector's size limit — #45).

It serializes to JSON and reloads exactly, so a stored result is never recomputed.

## 7. What it needs from elsewhere

- **fascia has no curve primitive.** `OverlayGuide` draws one straight segment between two
  points; the ball, the side plane and the curved lines need a polyline guide. That is PR 13's,
  alongside #40's off-frame work.
- **A sourced ball proportion**, when the corpus has one, replaces the chosen default (§1).

## 8. Decisions

- **Elements: the measured lines, plus the cranial ball and side plane** (Laurie, 2026-09-11).
  Hairline, ear and jaw wait.
- **The ball is sized by a chosen, labelled factor** on the measured brow-to-nose unit, set by
  eye against the fixtures and recorded as a judgement (Laurie, 2026-09-11).
- **Reliability is per anchor** (Laurie, 2026-09-11). Each anchor's value is the face-level
  `facial_landmark_reliability`, combined by `min` with how far that anchor's surface faces away
  from the camera — derived from the pose and the landmarks' own depth. An anchor on the far side
  of a turned head is extrapolated rather than observed; this measures that, a condition of the
  observation rather than a property of the face. The jaw is not one of the five anchors, so the
  walkthrough's flagged jaw becomes the flagged far-side anchor (234 or 454).
- **Five draggable anchors** — 9, 2, 152, 234 and 454 (Laurie, 2026-09-11).
- **Open: the per-anchor scaling** — how far from facing the camera an anchor may turn before it
  scores 0, to be set against the pose fixtures.
