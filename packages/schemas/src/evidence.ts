/**
 * The evidence taxonomy, as a closed type.
 *
 * `docs/design/requirements.md` §6 is normative: every assertion an agent emits carries
 * exactly one of three classes. The union being *closed* is the point — an unclassified
 * claim is a schema failure at the seam, before it can ever become a Plan Critic finding
 * (FR-603, FR-702 `unclassified_claim`).
 *
 * Two invariants are structural here rather than prompted:
 *
 * - `Measured.units` admits only pixel and normalised units, so FR-306 ("real-world units
 *   are never inferred from an uncalibrated photograph") has no field to be violated in.
 * - An artist assertion is never evidence (FR-1013). "The light comes from the left" may be
 *   adopted, but only as a `chosen` claim naming the artist as its reason — there is no path
 *   that promotes it to `measured` or `cited`.
 *
 * Field names are snake_case because the Python agent layer emits snake_case and this
 * package mirrors the wire format faithfully. See the README: a mirror that silently
 * renames fields is not a mirror.
 */

import { z } from 'zod';

/** SHA-256 of the immutable source upload (FR-105), lowercase hex. */
export const checksumSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'checksum must be lowercase hex SHA-256');

/**
 * Units a measurement may be reported in.
 *
 * Deliberately excludes every real-world unit. Adding `mm` here would silently retire
 * FR-306, so this array is the enforcement point — not a prompt instruction.
 */
export const MEASUREMENT_UNITS = ['px', 'normalized'] as const;

export const measuredSchema = z.object({
  kind: z.literal('measured'),
  tool: z.string().min(1),
  tool_version: z.string().min(1),
  /** The validated parameters the tool actually ran with, not the ones it was asked for. */
  parameters: z.record(z.string(), z.unknown()),
  source_checksum: checksumSchema,
  units: z.enum(MEASUREMENT_UNITS),
});

export const citedSchema = z.object({
  kind: z.literal('cited'),
  chunk_id: z.string().min(1),
  institution: z.string().min(1),
  url: z.url(),
  licence: z.string().min(1),
  retrieved_at: z.iso.datetime({ offset: true }),
  /** Character span within the retrieved chunk that supports the claim. */
  passage_span: z.object({
    start: z.int().nonnegative(),
    end: z.int().nonnegative(),
  }),
});

export const chosenSchema = z.object({
  kind: z.literal('chosen'),
  /** Why this call was made. When the artist supplied it, that is what this says. */
  reason: z.string().min(1),
  /** What was rejected. A choice with no alternative is a fact wearing a costume. */
  rejected_alternative: z.string().min(1),
});

export const evidenceSchema = z.discriminatedUnion('kind', [
  measuredSchema,
  citedSchema,
  chosenSchema,
]);

/** The atom every agent emits. There is no untagged string in a plan. */
export const claimSchema = z.object({
  text: z.string().min(1),
  evidence: evidenceSchema,
});

export type Measured = z.infer<typeof measuredSchema>;
export type Cited = z.infer<typeof citedSchema>;
export type Chosen = z.infer<typeof chosenSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];
