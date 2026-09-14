/**
 * The Studio Director's routing decision, as the studio will render it (routing-plan §3).
 *
 * Three parts, and only one of them is the model's:
 *
 * - `manifest` is what runs, and what was declined and why (FR-307).
 * - `rationale` is the routing summary the walkthrough's beat 4 renders.
 * - `gate` is the face gate's deterministic outcome, kept apart from the model's half.
 *
 * Completeness, meaning every offered tool named exactly once, is deliberately not checked here.
 * It is judged against the tools a producer was offered, which this contract cannot know, and the
 * Python producer applies it (routing-plan §10, question 2).
 *
 * Both objects are strict, mirroring Pydantic's `extra="forbid"`: an unknown field is refused on
 * both sides, rather than stripped here and rejected in Python. The nested `toolManifestSchema` is
 * not strict yet, so an unknown field inside `manifest` is still stripped.
 */

import { z } from 'zod';
import { toolManifestSchema } from './manifest';

export const routingGateSchema = z
  .strictObject({
    face_found: z.boolean(),
    /** The gate's own reason, present exactly when it declined head construction. */
    reason: z.string().min(1).nullable().default(null),
  })
  .refine(
    (gate) => gate.face_found === (gate.reason === null),
    'a gate that found no face must say why, and one that found a face has no reason',
  );

export const routingDecisionSchema = z
  .strictObject({
    manifest: toolManifestSchema,
    rationale: z.string().min(1),
    gate: routingGateSchema,
  })
  .refine(
    (decision) =>
      decision.gate.face_found ||
      !decision.manifest.selected.some((entry) => entry.tool === 'head_construction'),
    'head_construction cannot be selected when the gate found no face',
  );

export type RoutingGate = z.infer<typeof routingGateSchema>;
export type RoutingDecision = z.infer<typeof routingDecisionSchema>;
