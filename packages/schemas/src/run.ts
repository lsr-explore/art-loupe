/**
 * A run's progress events, and how a run ended (`python/libs/schemas/.../run.py`).
 *
 * A run is a background job, so its outcome arrives as the payload of its last event rather than
 * as a response: a `RunResult` on `succeeded`, a `RunFailure` on `failed`. The studio's route
 * handler validates every event against `runEventSchema` before passing it to the browser, which
 * is what "never render a decision that has not been validated" means for a stream.
 *
 * `runResultSchema` and `runFailureSchema` are mirrored in Python and pinned by the parity
 * fixture. The event envelope (`seq`, `kind`) is not: it is the run log's shape, written by
 * `artloupe.persistence`, and the SSE frame carries `seq` as its id.
 */

import { z } from 'zod';

import { artifactMetadataSchema } from './artifact';
import { planOutcomeSchema } from './plan';
import { routingDecisionSchema } from './routing';

/** Closed, because the studio localizes it. Widening it is a contract change on both sides. */
export const RUN_FAILURE_REASONS = [
  'budget_exceeded',
  'deadline_exceeded',
  'guard_stopped',
  'project_not_found',
  'project_not_ready',
  'photograph_unavailable',
  'credential_rejected',
  'data_service_refused',
  'routing_failed',
  'analysis_failed',
  'planning_failed',
  'critique_failed',
  'interrupted',
  'internal_error',
] as const;

export const runFailureSchema = z.strictObject({
  reason: z.enum(RUN_FAILURE_REASONS),
  /** English, safe to show, never an upstream error body. */
  detail: z.string(),
});

export const runResultSchema = z.strictObject({
  run_id: z.string(),
  owner: z.string(),
  project_id: z.string(),
  node_trail: z.array(z.string()),
  gate: z.record(z.string(), z.unknown()),
  routing: routingDecisionSchema,
  artifacts: z.array(artifactMetadataSchema),
  /**
   * The findings, lessons, plan and verdicts. Absent or `null` only on a run recorded before the
   * plan half of the graph existed, whose stored `succeeded` event must still validate on replay.
   */
  plan: planOutcomeSchema.nullable().optional(),
});

const nodePayloadSchema = z.strictObject({ node: z.string().min(1) });

export const runEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    seq: z.number().int().min(1),
    kind: z.literal('started'),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    seq: z.number().int().min(1),
    kind: z.literal('node_started'),
    payload: nodePayloadSchema,
  }),
  z.strictObject({
    seq: z.number().int().min(1),
    kind: z.literal('node_finished'),
    payload: nodePayloadSchema,
  }),
  z.strictObject({
    seq: z.number().int().min(1),
    kind: z.literal('succeeded'),
    payload: runResultSchema,
  }),
  z.strictObject({
    seq: z.number().int().min(1),
    kind: z.literal('failed'),
    payload: runFailureSchema,
  }),
]);

export type RunFailureReason = (typeof RUN_FAILURE_REASONS)[number];
export type RunFailure = z.infer<typeof runFailureSchema>;
export type RunResult = z.infer<typeof runResultSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type RunEventKind = RunEvent['kind'];
