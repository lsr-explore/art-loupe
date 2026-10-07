import { describe, expect, it } from 'vitest';

import fixture from '../fixtures/ops-runs-parity.json';
import { runDetailSchema, runHealthReportSchema } from './ops-runs';

// @trace flow=ops.observability category=data
describe('ops run-health contract parity', () => {
  const cases = [
    ['health', runHealthReportSchema, fixture.health],
    ['detail', runDetailSchema, fixture.detail],
  ] as const;
  for (const [name, schema, { accepts, rejects }] of cases) {
    for (const [index, value] of accepts.entries())
      it(`accepts ${name} ${index}`, () => expect(schema.safeParse(value).success).toBe(true));
    for (const [index, value] of rejects.entries())
      it(`rejects ${name} ${index}`, () => expect(schema.safeParse(value).success).toBe(false));
  }
});
