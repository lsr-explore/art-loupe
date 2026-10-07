import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mixedReport } from '@/components/costs/cost-panel.fixtures';

const getAccessToken = vi.hoisted(() => vi.fn());
const env = vi.hoisted(() => ({
  ARTLOUPE_AGENT_URL: 'http://127.0.0.1:8080' as string | undefined,
  NODE_ENV: 'test',
}));

vi.mock('server-only', () => ({}));
vi.mock('@artloupe/auth/server', () => ({ getAccessToken }));
vi.mock('@/env', () => ({ env }));

import { fetchCostReport } from './fetch-cost-report';

const respond = (status: number, body: unknown = {}) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body, { status }));

// @trace flow=ops.observability category=functionality
describe('fetchCostReport', () => {
  beforeEach(() => {
    getAccessToken.mockResolvedValue('operator-token');
    env.ARTLOUPE_AGENT_URL = 'http://127.0.0.1:8080';
    env.NODE_ENV = 'test';
  });
  afterEach(() => vi.restoreAllMocks());

  // @trace category=security
  it("sends the operator's own token and nothing else", async () => {
    const fetchSpy = respond(200, mixedReport);
    await fetchCostReport('7d');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://127.0.0.1:8080/ops/costs?window=7d');
    expect(init?.headers).toEqual({ Authorization: 'Bearer operator-token' });
  });

  it('returns the validated report', async () => {
    respond(200, mixedReport);
    expect(await fetchCostReport('7d')).toEqual({ status: 'ok', report: mixedReport });
  });

  it('refuses a report for a different window', async () => {
    respond(200, mixedReport);
    expect(await fetchCostReport('24h')).toEqual({ status: 'unavailable' });
  });

  it('refuses a malformed report', async () => {
    respond(200, { ...mixedReport, totals: { ...mixedReport.totals, priced_cost_usd: 0.03 } });
    expect(await fetchCostReport('7d')).toEqual({ status: 'unavailable' });
  });

  it.each([
    [401, 'signed-out'],
    [403, 'forbidden'],
    [503, 'unavailable'],
    [500, 'unavailable'],
  ] as const)('maps a %i to %s', async (status, expected) => {
    respond(status);
    expect(await fetchCostReport('7d')).toEqual({ status: expected });
  });

  it('is unavailable when the agent cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    expect(await fetchCostReport('7d')).toEqual({ status: 'unavailable' });
  });

  it('is signed out without a token, and never calls the agent', async () => {
    getAccessToken.mockResolvedValue(null);
    const fetchSpy = respond(200, mixedReport);
    expect(await fetchCostReport('7d')).toEqual({ status: 'signed-out' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is signed out when an expired session cannot be cleared during render', async () => {
    getAccessToken.mockRejectedValue(new Error('Cookies can only be modified in a Server Action'));
    expect(await fetchCostReport('7d')).toEqual({ status: 'signed-out' });
  });

  it('is unavailable when no agent is configured', async () => {
    env.ARTLOUPE_AGENT_URL = undefined;
    const fetchSpy = respond(200, mixedReport);
    expect(await fetchCostReport('7d')).toEqual({ status: 'unavailable' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // @trace category=security
  it('will not send a token over plain HTTP in production', async () => {
    env.NODE_ENV = 'production';
    const fetchSpy = respond(200, mixedReport);
    expect(await fetchCostReport('7d')).toEqual({ status: 'unavailable' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
