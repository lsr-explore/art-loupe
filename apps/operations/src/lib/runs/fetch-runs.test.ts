import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { failedDetail, healthReport } from '@/components/runs/run-health.fixtures';

const getAccessToken = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@artloupe/auth/server', () => ({ getAccessToken }));
vi.mock('@/env', () => ({
  env: { ARTLOUPE_AGENT_URL: 'http://127.0.0.1:8080', NODE_ENV: 'test' },
}));

import { fetchRunDetail, fetchRunHealth } from './fetch-runs';

const respond = (body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body));

// @trace flow=ops.observability category=functionality
describe('run-health fetchers', () => {
  beforeEach(() => getAccessToken.mockResolvedValue('operator-token'));
  afterEach(() => vi.restoreAllMocks());

  it('asks for the window and accepts a report for it', async () => {
    const fetchSpy = respond(healthReport);
    expect(await fetchRunHealth('7d')).toEqual({ status: 'ok', data: healthReport });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8080/ops/runs?window=7d');
  });

  it('refuses a report for a different window', async () => {
    respond(healthReport);
    expect(await fetchRunHealth('30d')).toEqual({ status: 'unavailable' });
  });

  it('refuses a drill-down for a different run', async () => {
    respond(failedDetail);
    expect(await fetchRunDetail('0b5f6a3e-2f4c-4d6b-9a8e-999999999999')).toEqual({
      status: 'unavailable',
    });
  });

  it('accepts the drill-down for the run it asked about', async () => {
    const fetchSpy = respond(failedDetail);
    expect(await fetchRunDetail(failedDetail.run.run_id)).toEqual({
      status: 'ok',
      data: failedDetail,
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      `http://127.0.0.1:8080/ops/runs/${failedDetail.run.run_id}`,
    );
  });
});
