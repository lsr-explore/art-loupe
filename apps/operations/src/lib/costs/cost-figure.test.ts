import { describe, expect, it } from 'vitest';

import { costFigure } from './cost-figure';

const totals = (priced: string, unpriced: number, executions: number) => ({
  priced_cost_usd: priced,
  unpriced_rows: unpriced,
  node_executions: executions,
});

// @trace flow=ops.observability category=data
describe('costFigure', () => {
  it('states a fully priced sum as the cost', () => {
    expect(costFigure(totals('0.031500', 0, 3))).toEqual({ kind: 'priced', usd: 0.0315 });
  });

  it('keeps a real zero as a priced zero', () => {
    expect(costFigure(totals('0', 0, 2))).toEqual({ kind: 'priced', usd: 0 });
  });

  it('never states an all-unpriced grouping as zero', () => {
    expect(costFigure(totals('0', 2, 2))).toEqual({ kind: 'unpriced', unpricedRows: 2 });
  });

  it('marks a sum with any unpriced row as a lower bound', () => {
    expect(costFigure(totals('0.02', 1, 3))).toEqual({
      kind: 'partial',
      usd: 0.02,
      unpricedRows: 1,
    });
  });

  it('treats an empty grouping as a priced zero', () => {
    expect(costFigure(totals('0', 0, 0))).toEqual({ kind: 'priced', usd: 0 });
  });
});
