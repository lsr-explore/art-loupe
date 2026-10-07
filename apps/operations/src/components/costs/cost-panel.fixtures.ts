import type { CostReport, CostTotals } from '@artloupe/schemas/ops-cost';

export const totals = (overrides: Partial<CostTotals> = {}): CostTotals => ({
  node_executions: 1,
  reexecutions: 0,
  priced_cost_usd: '0',
  unpriced_rows: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  duration_ms: 0,
  ...overrides,
});

/** One window with every way a cost can read: priced, a real zero, unpriced, and partial. */
export const mixedReport: CostReport = {
  window: '7d',
  since: '2026-09-30T12:00:00Z',
  generated_at: '2026-10-07T12:00:00Z',
  run_count: 3,
  totals: totals({
    node_executions: 5,
    reexecutions: 1,
    priced_cost_usd: '0.031500',
    unpriced_rows: 1,
    input_tokens: 3000,
    output_tokens: 900,
    duration_ms: 5120,
  }),
  by_model: [
    { model: 'claude-opus-5', ...totals({ node_executions: 2, priced_cost_usd: '0.031500' }) },
    { model: 'claude-unknown-9', ...totals({ unpriced_rows: 1 }) },
    { model: null, ...totals({ node_executions: 2 }) },
  ],
  by_node: [
    {
      node: 'route',
      ...totals({
        node_executions: 3,
        reexecutions: 1,
        priced_cost_usd: '0.0315',
        unpriced_rows: 1,
      }),
    },
    { node: 'plates', ...totals({ node_executions: 2, duration_ms: 1500 }) },
  ],
  recent_runs: [
    {
      run_id: 'run-b',
      started_at: '2026-10-06T09:30:00Z',
      ...totals({ unpriced_rows: 1 }),
    },
    {
      run_id: 'run-a',
      started_at: '2026-10-05T08:00:00Z',
      ...totals({ node_executions: 4, priced_cost_usd: '0.0315' }),
    },
  ],
};

export const emptyReport: CostReport = {
  ...mixedReport,
  run_count: 0,
  totals: totals({ node_executions: 0 }),
  by_model: [],
  by_node: [],
  recent_runs: [],
};
