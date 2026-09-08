/**
 * What the artist told us they are trying to do (FR-102, FR-104).
 *
 * Medium and time are required because both change tool selection; everything else has a
 * default, so intake stays one short form rather than an interview. The Studio Director may
 * ask at most one clarifying question on top of this, and only when the answer changes the
 * manifest (FR-103) — asking zero is the normal case.
 *
 * `goal` is free text the artist wrote. It is **untrusted input** on the same footing as
 * EXIF and filename (FR-106): screened at ingest, never interpreted as instruction.
 */

import { z } from 'zod';
import { MEDIA, SKILL_LEVELS } from './intent-values';

/**
 * `MEDIA` and `SKILL_LEVELS` live in `intent-values.ts`, not here.
 *
 * They are plain arrays and the intake form renders its options from them, so leaving them in
 * this module — which imports `zod` at the top — would put the whole validator in the client
 * bundle for the sake of seven strings. Re-exported so the barrel's surface is unchanged.
 */
export { MEDIA, type Medium, SKILL_LEVELS, type SkillLevel } from './intent-values';

/**
 * Physical size of what the artist is working on.
 *
 * Real-world units are correct *here* and nowhere near a measurement. FR-306 forbids
 * inferring real-world units from an uncalibrated photograph; this is the artist stating
 * the size of a thing they are holding, which is a different act. Do not "fix" this to
 * match `Measured.units`.
 */
export const supportSizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  units: z.enum(['mm', 'in']),
});

export const projectIntentSchema = z.object({
  medium: z.enum(MEDIA),
  time_budget_minutes: z.int().positive(),
  support: supportSizeSchema.nullable().default(null),
  skill_level: z.enum(SKILL_LEVELS).default('intermediate'),
  /** Untrusted artist text (FR-106). Screened at ingest, never instruction. */
  goal: z.string().max(2000).nullable().default(null),
});

export type SupportSize = z.infer<typeof supportSizeSchema>;
export type ProjectIntent = z.infer<typeof projectIntentSchema>;
