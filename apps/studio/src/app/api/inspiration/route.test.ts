// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const token = vi.hoisted(() => vi.fn());
const identity = vi.hoisted(() => vi.fn());
vi.mock('@artloupe/auth/server', () => ({ getAccessToken: token }));
vi.mock('@/lib/inspiration/cloud-run', () => ({ cloudRunHeaders: identity }));
vi.mock('@/env', () => ({ env: { ARTLOUPE_AGENT_URL: 'https://test.run.app' } }));

import { GET } from './route';

const request = (query = 'source=met&query=trees') =>
  new Request(`https://studio.test/api/inspiration?${query}`);
beforeEach(() => {
  vi.restoreAllMocks();
  token.mockResolvedValue('user-token');
  identity.mockResolvedValue({ 'X-Serverless-Authorization': 'Bearer cloud-token' });
});
// @trace flow=inspiration.search category=security
describe('inspiration.search: backend bridge', () => {
  it('does not call the backend for an unauthenticated request', async () => {
    token.mockResolvedValue(null);
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await GET(request())).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects incompatible provider filters', async () =>
    expect((await GET(request('source=met&query=trees&color=blue'))).status).toBe(400));
  it('forwards separate user and Cloud Run identities and validates the response', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ items: [], page: 1, has_more: false, stale: false, partial: false }),
      );
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(fetch.mock.calls[0][1]?.headers).toEqual({
      'X-Serverless-Authorization': 'Bearer cloud-token',
      Authorization: 'Bearer user-token',
      'Content-Type': 'application/json',
    });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('maps a backend outage without leaking its body', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('secret details'));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
  });
  it('rejects malformed backend data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ items: 'bad' }));
    expect((await GET(request())).status).toBe(503);
  });
  it('keeps rate limits distinct', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('secret', { status: 429 }));
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(await response.json()).toEqual({ error: 'rate_limited' });
  });
  it("passes the artist's own wait through from the backend", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 429, headers: { 'Retry-After': '4' } }),
    );
    expect((await GET(request())).headers.get('Retry-After')).toBe('4');
  });
  it('reports a spent provider quota as an outage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));
    expect(await (await GET(request())).json()).toEqual({ error: 'search_unavailable' });
  });
});
