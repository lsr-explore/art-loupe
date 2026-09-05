/* eslint-disable @next/next/no-img-element -- fascia is framework-agnostic and has no Next
   dependency to import `next/image` from. This fixture stands in for whatever a consuming app
   renders as the canvas child and never ships, so the rule's LCP concern does not apply. */
import type { OverlayCanvasLabels } from './overlay-canvas';
import type { OverlayHandleLabels } from './overlay-handle';

/**
 * Label bundles for the overlay tests.
 *
 * Separate from the tests themselves per the repo's testing rules, and worth keeping separate
 * on its own merits: these stand in for what a consuming app assembles from `next-intl`, so
 * every test exercising the primitives shares one shape rather than each inventing its own
 * and quietly drifting from what an app would actually pass.
 */
export const canvasLabels: OverlayCanvasLabels = {
  groupLabel: 'Head construction guides',
  instructions:
    'Use the arrow keys to move a guide, or click it and then click the photograph to place it.',
  armedAnnouncement: (handleName) => `${handleName} armed. Click the photograph to place it.`,
  placementTargetLabel: (handleName) => `Place ${handleName} on the photograph`,
};

export const handleLabels: OverlayHandleLabels = {
  name: 'Jaw landmark',
  describeHandle: ({ name, xPercent, yPercent, status }) =>
    `${name}, ${xPercent}% across, ${yPercent}% down, ${status}`,
  announceMove: ({ name, xPercent, yPercent }) =>
    `${name} moved to ${xPercent}% across, ${yPercent}% down.`,
};

/**
 * The photograph the overlay tests draw over.
 *
 * A plain `<img>`, with `noImgElement` suppressed once here rather than in each harness.
 * `next/image` is the rule's target and fascia is framework-agnostic by design — it has no
 * Next dependency and must not grow one for a test fixture. The suppression is also honest
 * about scope: this element never ships, it only stands in for whatever the consuming app
 * renders as `children`.
 */
export const FixturePhotograph = () => (
  // biome-ignore lint/performance/noImgElement: fascia has no Next dependency and must not gain one for a test fixture.
  <img alt="Reference photograph" src="/fixture.jpg" />
);
