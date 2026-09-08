/**
 * The reference photograph, as a reference rather than as bytes.
 *
 * FR-101 sets the accepted formats and bounds; FR-105 makes the original immutable and
 * makes the checksum the thing derivatives point back to. Nothing downstream ever holds
 * the pixels — every study, every plate, and every cache entry is keyed on `checksum`,
 * which is the only identifier that survives a rotating signed URL.
 *
 * HEIC is accepted by FR-101 but excluded here for slice 1: Pillow needs `pillow-heif` to
 * decode it and no browser will render it, so admitting it to the contract before the
 * decode path exists would let an unusable upload through validation.
 */

import { z } from 'zod';
import { checksumSchema } from './evidence';
import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES, MIN_LONG_EDGE_PX } from './image-limits';

/**
 * The bounds live in `image-limits.ts`, not here — see `intent-values.ts` for why. The intake
 * form states them to the artist before a file is chosen, and it must not pull `zod` in to do
 * it. Re-exported so the barrel's surface is unchanged.
 */
export {
  ACCEPTED_MIME_TYPES,
  type AcceptedMimeType,
  MAX_UPLOAD_BYTES,
  MIN_LONG_EDGE_PX,
} from './image-limits';

export const imageRefSchema = z
  .object({
    checksum: checksumSchema,
    /** Object key within the private bucket. Never a URL — signed URLs expire. */
    storage_key: z.string().min(1),
    mime_type: z.enum(ACCEPTED_MIME_TYPES),
    width_px: z.int().positive(),
    height_px: z.int().positive(),
    byte_size: z.int().positive().max(MAX_UPLOAD_BYTES),
  })
  .refine(
    (image) => Math.max(image.width_px, image.height_px) >= MIN_LONG_EDGE_PX,
    `the long edge must be at least ${MIN_LONG_EDGE_PX}px (FR-101)`,
  );

export type ImageRef = z.infer<typeof imageRefSchema>;
