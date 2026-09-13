/**
 * What the Studio Director decided to run, and what it decided not to (FR-307).
 *
 * The declination half is the load-bearing one. "Tool selection is a decision, not a
 * fixture. A run must be able to decline a tool and say why — a portrait run declines
 * perspective, and that refusal is visible." A manifest that could only ever list what ran
 * would make the Director a lookup table, so `reason` is required on every declination and
 * optional on every selection.
 */

import { z } from 'zod';

/**
 * Tools the graph can select in slice 1.
 *
 * The four plates share one pipeline. `value_map` posterises into two to ten values;
 * `value_shapes` traces the boundaries between those value regions, so it always corresponds to
 * the map and finds a boundary wherever the histogram has a gap, however shallow; `outline`
 * traces edges in a texture-flattened copy and fits straight runs as straight lines, so it is
 * clean where `value_shapes` wanders and blind where the photograph has no gradient to give.
 * They are selected separately because a run can want one and not the other.
 */
export const TOOLS = [
  'grayscale',
  'value_map',
  'value_shapes',
  'outline',
  'head_construction',
  'perspective',
] as const;

export const toolSelectionSchema = z.object({
  tool: z.enum(TOOLS),
  /** Optional: a selection explains itself less often than a refusal needs to. */
  reason: z.string().min(1).nullable().default(null),
});

export const toolDeclinationSchema = z.object({
  tool: z.enum(TOOLS),
  /** Required by FR-307 — a silent decline is indistinguishable from a bug. */
  reason: z.string().min(1),
});

export const toolManifestSchema = z
  .object({
    selected: z.array(toolSelectionSchema),
    declined: z.array(toolDeclinationSchema),
  })
  .refine((manifest) => {
    const selectedTools = new Set(manifest.selected.map((entry) => entry.tool));
    return manifest.declined.every((entry) => !selectedTools.has(entry.tool));
  }, 'a tool cannot be both selected and declined');

export type ToolName = (typeof TOOLS)[number];
export type ToolSelection = z.infer<typeof toolSelectionSchema>;
export type ToolDeclination = z.infer<typeof toolDeclinationSchema>;
export type ToolManifest = z.infer<typeof toolManifestSchema>;
