/**
 * The FR-101 bounds on an uploaded reference photograph, with no Zod behind them.
 *
 * Split out of `image.ts` for the same reason as `intent-values.ts`: the intake form states
 * these limits to the artist before they choose a file, and importing them through the
 * package barrel would drag Zod into the client bundle to do it. See `intent-values.ts` for
 * the measurement.
 *
 * These are the *only* statement of the bounds on the TypeScript side. `image.ts` builds its
 * schema from them, and the same numbers are a check constraint in
 * `20260905183000_create_projects_and_reference_images.sql` — which is what makes a refusal
 * load bearing rather than advisory.
 */

/** FR-101 accepted formats, minus HEIC. Widening this needs a decode path to match. */
export const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** FR-101: 25 MB. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** FR-101: the long edge must reach this, or the studies have nothing to measure. */
export const MIN_LONG_EDGE_PX = 800;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];
