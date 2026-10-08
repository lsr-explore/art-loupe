import { z } from 'zod/v4';

import { COST_WINDOWS, costTotalsSchema } from './ops-cost';

/**
 * Run health and one run's drill-down (FR-901), as `GET /ops/runs` and `GET /ops/runs/{id}`
 * return them. Mirrors `artloupe.agent.ops_runs_models`; `fixtures/ops-runs-parity.json` is
 * asserted by both suites.
 *
 * Built from what `artloupe_ops_reader` may read: never a run's `result` or its owner.
 * `reason` stays an open string here so one unexpected code cannot blank the whole panel; the
 * UI labels the codes in `RUN_FAILURE_REASONS` and shows any other code as it is.
 */

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

const count = z.number().int().nonnegative();
const timestamp = z.iso.datetime({ offset: true });
const usd = z.string().regex(/^\d+(\.\d+)?$/);

const durationStatsSchema = z
  .object({ runs: count, p50_ms: count.nullable(), p95_ms: count.nullable() })
  .strict();

export const runSummarySchema = z
  .object({
    run_id: z.uuid(),
    project_id: z.uuid(),
    status: z.enum(RUN_STATUSES),
    stalled: z.boolean(),
    reason: z.string().nullable(),
    failed_node: z.string().nullable(),
    created_at: timestamp,
    started_at: timestamp.nullable(),
    finished_at: timestamp.nullable(),
    cost: z
      .object({ node_executions: count, priced_cost_usd: usd, unpriced_rows: count })
      .strict()
      .nullable(),
  })
  .strict();

export const runHealthReportSchema = z
  .object({
    window: z.enum(COST_WINDOWS),
    since: timestamp,
    generated_at: timestamp,
    stall_after_seconds: z.number().int().min(1),
    run_count: count,
    status_counts: z
      .object({ queued: count, running: count, succeeded: count, failed: count })
      .strict(),
    queue_wait: durationStatsSchema,
    run_time: durationStatsSchema,
    failures: z.array(
      z
        .object({
          reason: z.string(),
          failed_node: z.string().nullable(),
          runs: z.number().int().min(1),
        })
        .strict(),
    ),
    stalled_count: count,
    stalled: z.array(runSummarySchema).max(50),
    recent_runs: z.array(runSummarySchema).max(50),
  })
  .strict();

export const runDetailSchema = z
  .object({
    run: runSummarySchema,
    error_detail: z.string().nullable(),
    events: z.array(
      z
        .object({
          seq: z.number().int().min(1),
          kind: z.enum(['started', 'node_started', 'node_finished', 'succeeded', 'failed']),
          node: z.string().nullable(),
          reason: z.string().nullable(),
          created_at: timestamp,
          offset_ms: count,
        })
        .strict(),
    ),
    steps: z.array(
      z
        .object({
          node: z.string(),
          started_at: timestamp.nullable(),
          finished_at: timestamp.nullable(),
          duration_ms: count.nullable(),
        })
        .strict(),
    ),
    ledger: z.array(costTotalsSchema.extend({ node: z.string() }).strict()),
  })
  .strict();

export type RunSummary = z.infer<typeof runSummarySchema>;
export type RunHealthReport = z.infer<typeof runHealthReportSchema>;
export type RunDetail = z.infer<typeof runDetailSchema>;
