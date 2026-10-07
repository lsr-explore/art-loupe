import { z } from 'zod/v4';

/**
 * The cost report `GET /ops/costs` returns. Mirrors `artloupe.agent.ops_cost_models`;
 * `fixtures/ops-cost-parity.json` is asserted by both suites.
 *
 * A null `cost_usd` in the ledger means unpriced, not free. Every grouping therefore carries
 * two figures: `priced_cost_usd` sums only the priced rows, and `unpriced_rows` counts the
 * rest. A total with any unpriced row is a lower bound and must be shown as one.
 */

export const COST_WINDOWS = ['24h', '7d', '30d'] as const;
export type CostWindow = (typeof COST_WINDOWS)[number];

const count = z.number().int().nonnegative();

// Pydantic serializes `Decimal` as a string. Kept a string here, so no float rounds it.
const usd = z.string().regex(/^\d+(\.\d+)?$/);

const costTotalsShape = {
  node_executions: count,
  reexecutions: count,
  priced_cost_usd: usd,
  unpriced_rows: count,
  input_tokens: count,
  output_tokens: count,
  cache_read_tokens: count,
  cache_write_tokens: count,
  duration_ms: count,
};

export const costTotalsSchema = z.object(costTotalsShape).strict();

export const costReportSchema = z
  .object({
    window: z.enum(COST_WINDOWS),
    since: z.iso.datetime({ offset: true }),
    generated_at: z.iso.datetime({ offset: true }),
    run_count: count,
    totals: costTotalsSchema,
    by_model: z.array(z.object({ ...costTotalsShape, model: z.string().nullable() }).strict()),
    by_node: z.array(z.object({ ...costTotalsShape, node: z.string() }).strict()),
    recent_runs: z
      .array(
        z
          .object({
            ...costTotalsShape,
            run_id: z.string(),
            started_at: z.iso.datetime({ offset: true }),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type CostTotals = z.infer<typeof costTotalsSchema>;
export type CostReport = z.infer<typeof costReportSchema>;
