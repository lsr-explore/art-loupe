import { describe, expect, it } from 'vitest';

import fixture from '../fixtures/ops-cost-parity.json';
import { costReportSchema } from './ops-cost';

// @trace flow=ops.observability category=data
describe('ops cost contract parity', () => {
  for (const [index, value] of fixture.accepts.entries())
    it(`accepts report ${index}`, () =>
      expect(costReportSchema.safeParse(value).success).toBe(true));
  for (const [index, value] of fixture.rejects.entries())
    it(`rejects report ${index}`, () =>
      expect(costReportSchema.safeParse(value).success).toBe(false));
  it('refuses a cost sent as a float', () => {
    const [report] = fixture.accepts;
    expect(
      costReportSchema.safeParse({
        ...report,
        totals: { ...report?.totals, priced_cost_usd: 0.03 },
      }).success,
    ).toBe(false);
  });
});
