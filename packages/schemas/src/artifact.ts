/**
 * What a deterministic tool returns alongside its artifact (FR-305).
 *
 * "Every tool returns an artifact **plus machine-readable metadata**: tool name and
 * version, validated parameters, source checksum, duration, confidence, and stated
 * limitations. Agents cite the metadata; they never describe an artifact from memory."
 *
 * That last clause is why this type exists rather than a loose object. An agent describing
 * a plate it did not read is the failure mode the whole measured/cited/chosen taxonomy is
 * built to prevent, and it starts with metadata being optional.
 *
 * Slice 1 keeps no derivative pixels: the artifact is reproducible from
 * `(source_checksum, tool, tool_version, parameters)`, so the recipe is stored and the
 * plate is regenerated rather than persisted.
 */

import { z } from 'zod';
import { checksumSchema } from './evidence';
import { TOOLS } from './manifest';

export const artifactMetadataSchema = z.object({
  tool: z.enum(TOOLS),
  tool_version: z.string().min(1),
  /** What the tool ran with after validation, not what it was asked for. */
  parameters: z.record(z.string(), z.unknown()),
  source_checksum: checksumSchema,
  duration_ms: z.int().nonnegative(),
  /**
   * Per-artifact confidence, `null` where the notion is meaningless.
   *
   * A grayscale conversion has no confidence — it either ran or it did not. A vanishing
   * point does, and below threshold it is what raises the interrupt (FR-401/402) rather
   * than being asserted with a caveat. `null` and `0` are different claims; do not
   * collapse them to a default.
   */
  confidence: z.number().min(0).max(1).nullable(),
  /** What this artifact does not show. Empty is a claim, not an omission. */
  limitations: z.array(z.string().min(1)),
});

export type ArtifactMetadata = z.infer<typeof artifactMetadataSchema>;
