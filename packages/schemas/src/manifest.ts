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
 * The three plates share one pipeline — `three_value` posterises, and `outline` traces the
 * boundaries between those value regions rather than raw gradients, which is why the two
 * always correspond and why the outline carries no texture speckle.
 */
export const TOOLS = [
  'grayscale',
  'three_value',
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
