import type { CostTotals } from '@artloupe/schemas/ops-cost';

/**
 * How a grouping's cost may honestly be stated.
 *
 * A null `cost_usd` means the model was not in the price table: unpriced, not free.
 * - `priced`: every row carries a price, so the sum is the cost. Zero is a real zero.
 * - `partial`: some rows are unpriced, so the sum is only a lower bound.
 * - `unpriced`: no row carries a price, so there is no figure to show at all.
 */
export type CostFigure =
  | { kind: 'priced'; usd: number }
  | { kind: 'partial'; usd: number; unpricedRows: number }
  | { kind: 'unpriced'; unpricedRows: number };

export const costFigure = (
  totals: Pick<CostTotals, 'priced_cost_usd' | 'unpriced_rows' | 'node_executions'>,
): CostFigure => {
  const usd = Number(totals.priced_cost_usd);
  if (totals.unpriced_rows === 0) return { kind: 'priced', usd };
  if (totals.unpriced_rows >= totals.node_executions)
    return { kind: 'unpriced', unpricedRows: totals.unpriced_rows };
  return { kind: 'partial', usd, unpricedRows: totals.unpriced_rows };
};
