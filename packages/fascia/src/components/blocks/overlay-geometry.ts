/**
 * The coordinate space every overlay primitive shares.
 *
 * **Normalized, not pixels.** A point is `{ x, y }` in `[0, 1]`, origin top-left. Three
 * reasons this is the contract rather than an implementation detail:
 *
 * - It is what the detector already emits. MediaPipe's `face_landmarker` returns normalized
 *   landmarks, so a pixel-based overlay would convert on the way in, store a number that is
 *   only meaningful next to the image dimensions it came from, and convert back on the way
 *   out. Every one of those conversions is a place to lose the correction.
 * - A correction persisted under FR-403 is an **artist-authored fact** that outlives the
 *   viewport it was made in. Storing 0.4627 survives a re-render at a different size; storing
 *   `642px` does not.
 * - The source upload is immutable (FR-105) but its derivatives are rendered at whatever size
 *   the layout gives them. Normalized coordinates are the only representation that means the
 *   same thing in both.
 *
 * Nothing here knows about React. Keeping the arithmetic separate is what lets the geometry be
 * tested without rendering, and what stops each primitive growing its own slightly different
 * clamp.
 */

/** A point in the normalized overlay space: `[0, 1]` on both axes, origin top-left. */
export interface OverlayPoint {
  x: number;
  y: number;
}

/**
 * How far a single arrow-key press moves a handle, as a fraction of the image.
 *
 * 0.002 is roughly one pixel on a 500 px-wide rendering and about two on a 1000 px one — fine
 * enough that a keyboard user can land a landmark precisely, which is the whole point of the
 * non-pointer path. `COARSE` is the shifted step, for crossing the image without holding a key
 * down for a hundred presses.
 */
export const NUDGE_FINE = 0.002;
export const NUDGE_COARSE = 0.02;

/**
 * The minimum interactive target, in CSS pixels — WCAG 2.2 SC 2.5.8 (Target Size, Minimum).
 *
 * Exported rather than inlined as a Tailwind class so the a11y tests can assert against the
 * same number the components lay out with. A handle may *draw* something smaller than this; it
 * may never be *hittable* in less.
 */
export const MIN_TARGET_PX = 24;

/** Clamp to the unit square. A guide dragged past the edge stays on the photograph. */
export const clampPoint = (point: OverlayPoint): OverlayPoint => ({
  x: Math.min(1, Math.max(0, point.x)),
  y: Math.min(1, Math.max(0, point.y)),
});

/**
 * Convert a pointer position within an element's box to normalized coordinates.
 *
 * Takes the rect rather than reading it off the element so callers can hold one measurement
 * across a drag — `getBoundingClientRect()` per `pointermove` is both slower and wrong if the
 * page scrolls mid-drag.
 */
export const pointFromClientPosition = (
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): OverlayPoint => {
  // A zero-sized rect happens in jsdom and during the first paint. Returning the origin beats
  // returning NaN, which would poison the persisted correction rather than merely misplace it.
  if (rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0 };
  }
  return clampPoint({
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height,
  });
};

/** Percentage strings for CSS positioning. Kept here so no component hand-rolls the `%`. */
export const toPercent = (point: OverlayPoint) => ({
  left: `${point.x * 100}%`,
  top: `${point.y * 100}%`,
});

/**
 * Round a normalized coordinate for announcement to assistive technology.
 *
 * Whole percentages: a screen-reader user nudging a landmark needs to hear that it moved and
 * roughly where to, not fourteen decimal places re-read on every keypress.
 */
export const describePoint = (point: OverlayPoint) => ({
  xPercent: Math.round(point.x * 100),
  yPercent: Math.round(point.y * 100),
});

/**
 * The lifecycle of a guide the agent drew, mirroring the region states in the design docs.
 *
 * This is a closed union on purpose. `proposed` is the agent's guess and **is cited by
 * nothing** — only `confirmed` and `adjusted` back a measured claim. A primitive that let a
 * caller pass an arbitrary string would make that invariant a convention rather than a type.
 */
export type OverlayStatus = 'proposed' | 'confirmed' | 'adjusted';
