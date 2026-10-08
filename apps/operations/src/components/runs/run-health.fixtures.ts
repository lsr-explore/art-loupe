import type { RunDetail, RunHealthReport, RunSummary } from '@artloupe/schemas/ops-runs';

const run = (overrides: Partial<RunSummary>): RunSummary => ({
  run_id: '0b5f6a3e-2f4c-4d6b-9a8e-111111111111',
  project_id: '0b5f6a3e-2f4c-4d6b-9a8e-222222222222',
  status: 'succeeded',
  stalled: false,
  reason: null,
  failed_node: null,
  created_at: '2026-10-07T11:00:00Z',
  started_at: '2026-10-07T11:00:01Z',
  finished_at: '2026-10-07T11:00:11Z',
  cost: { node_executions: 2, priced_cost_usd: '0.020000', unpriced_rows: 0 },
  ...overrides,
});

export const succeededRun = run({});

export const failedRun = run({
  run_id: '0b5f6a3e-2f4c-4d6b-9a8e-333333333333',
  status: 'failed',
  reason: 'deadline_exceeded',
  failed_node: 'plates',
  finished_at: '2026-10-07T11:00:05Z',
  cost: null,
});

export const unknownReasonRun = run({
  run_id: '0b5f6a3e-2f4c-4d6b-9a8e-555555555555',
  status: 'failed',
  reason: 'brand_new_reason',
  cost: null,
});

export const stuckRun = run({
  run_id: '0b5f6a3e-2f4c-4d6b-9a8e-444444444444',
  status: 'running',
  stalled: true,
  created_at: '2026-10-04T11:00:00Z',
  started_at: '2026-10-04T11:00:01Z',
  finished_at: null,
  cost: null,
});

export const healthReport: RunHealthReport = {
  window: '7d',
  since: '2026-09-30T12:00:00Z',
  generated_at: '2026-10-07T12:00:00Z',
  stall_after_seconds: 660,
  run_count: 3,
  status_counts: { queued: 0, running: 0, succeeded: 1, failed: 2 },
  queue_wait: { runs: 3, p50_ms: 1000, p95_ms: 1900 },
  run_time: { runs: 3, p50_ms: 10_000, p95_ms: 75_000 },
  failures: [
    { reason: 'deadline_exceeded', failed_node: 'plates', runs: 1 },
    { reason: 'brand_new_reason', failed_node: null, runs: 1 },
  ],
  stalled_count: 1,
  stalled: [stuckRun],
  recent_runs: [failedRun, unknownReasonRun, succeededRun],
};

export const quietReport: RunHealthReport = {
  ...healthReport,
  run_count: 0,
  status_counts: { queued: 0, running: 0, succeeded: 0, failed: 0 },
  queue_wait: { runs: 0, p50_ms: null, p95_ms: null },
  run_time: { runs: 0, p50_ms: null, p95_ms: null },
  failures: [],
  stalled_count: 0,
  stalled: [],
  recent_runs: [],
};

export const failedDetail: RunDetail = {
  run: failedRun,
  error_detail: 'The run ran out of time.',
  events: [
    {
      seq: 1,
      kind: 'started',
      node: null,
      reason: null,
      created_at: '2026-10-07T11:00:01Z',
      offset_ms: 1000,
    },
    {
      seq: 2,
      kind: 'node_started',
      node: 'route',
      reason: null,
      created_at: '2026-10-07T11:00:02Z',
      offset_ms: 2000,
    },
    {
      seq: 3,
      kind: 'node_finished',
      node: 'route',
      reason: null,
      created_at: '2026-10-07T11:00:03Z',
      offset_ms: 3000,
    },
    {
      seq: 4,
      kind: 'node_started',
      node: 'plates',
      reason: null,
      created_at: '2026-10-07T11:00:04Z',
      offset_ms: 4000,
    },
    {
      seq: 5,
      kind: 'failed',
      node: null,
      reason: 'deadline_exceeded',
      created_at: '2026-10-07T11:00:05Z',
      offset_ms: 5000,
    },
  ],
  steps: [
    {
      node: 'route',
      started_at: '2026-10-07T11:00:02Z',
      finished_at: '2026-10-07T11:00:03Z',
      duration_ms: 1000,
    },
    { node: 'plates', started_at: '2026-10-07T11:00:04Z', finished_at: null, duration_ms: null },
  ],
  ledger: [],
};
