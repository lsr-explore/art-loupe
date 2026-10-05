import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/inspiration-parity.json';
import { inspirationRequestSchema, inspirationResponseSchema } from './inspiration';

// @trace flow=inspiration.search category=data
describe('inspiration contract parity', () => {
  for (const value of fixture.accepts)
    it(`accepts ${JSON.stringify(value)}`, () =>
      expect(inspirationRequestSchema.safeParse(value).success).toBe(true));
  for (const value of fixture.rejects)
    it(`rejects ${JSON.stringify(value)}`, () =>
      expect(inspirationRequestSchema.safeParse(value).success).toBe(false));
  it('rejects unapproved image origins', () =>
    expect(
      inspirationResponseSchema.safeParse({
        items: [{ image_url: 'https://evil.example/a' }],
        page: 1,
        has_more: false,
        partial: false,
        stale: false,
      }).success,
    ).toBe(false));
});
