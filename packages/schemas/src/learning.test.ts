import { describe, expect, it } from 'vitest';

import fixture from '../fixtures/learning-parity.json';
import { learningRequestSchema, learningResponseSchema } from './learning';

// @trace flow=retrieval.grounding category=data
describe('learning contract parity', () => {
  for (const value of fixture.request_accepts)
    it(`accepts ${JSON.stringify(value)}`, () =>
      expect(learningRequestSchema.safeParse(value).success).toBe(true));
  for (const value of fixture.request_rejects)
    it(`rejects ${JSON.stringify(value)}`, () =>
      expect(learningRequestSchema.safeParse(value).success).toBe(false));
  it('accepts a server-resolved citation', () =>
    expect(learningResponseSchema.safeParse(fixture.answer).success).toBe(true));
  it('rejects citations absent from the evidence', () =>
    expect(learningResponseSchema.safeParse({ ...fixture.answer, sources: [] }).success).toBe(
      false,
    ));
  it('rejects an answer disguised as an evidence gap', () =>
    expect(
      learningResponseSchema.safeParse({ ...fixture.answer, status: 'insufficient_evidence' })
        .success,
    ).toBe(false));
  it('rejects unsafe source URLs', () =>
    expect(
      learningResponseSchema.safeParse({
        ...fixture.answer,
        sources: [{ ...fixture.answer.sources[0], url: 'javascript:alert(1)' }],
      }).success,
    ).toBe(false));
});
