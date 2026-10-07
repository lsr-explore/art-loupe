import { beforeEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../../../../../packages/schemas/fixtures/learning-parity.json';
const token = vi.hoisted(() => vi.fn());
const identity = vi.hoisted(() => vi.fn());
vi.mock('@artloupe/auth/server', () => ({ getAccessToken: token }));
vi.mock('@/lib/inspiration/cloud-run', () => ({ cloudRunHeaders: identity }));
vi.mock('@/env', () => ({ env: { ARTLOUPE_AGENT_URL: 'https://test.run.app' } }));
import { POST } from './route';
const request = (body: unknown = { question: 'What is value?' }, origin = 'https://studio.test') =>
  new Request('https://studio.test/api/learning', {
    method: 'POST',
    headers: { Origin: origin },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.restoreAllMocks();
  token.mockResolvedValue('artist-token');
  identity.mockResolvedValue({ 'X-Serverless-Authorization': 'Bearer cloud-token' });
});
// @trace flow=retrieval.grounding category=security
describe('learning backend bridge', () => {
  it('authenticates before reading or forwarding a question', async () => {
    token.mockResolvedValue(null);
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await POST(request())).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a cross-origin POST', async () =>
    expect((await POST(request({}, 'https://other.test'))).status).toBe(403));
  it('rejects oversized bodies even without Content-Length', async () =>
    expect((await POST(request({ question: 'x'.repeat(70000) }))).status).toBe(400));
  it('validates the request and its unknown fields', async () =>
    expect((await POST(request({ question: 'What is value?', owner: 'other' }))).status).toBe(400));
  it('forwards two identities separately and returns private evidence', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(fixture.answer));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(fetch.mock.calls[0][1]?.headers).toEqual({
      'X-Serverless-Authorization': 'Bearer cloud-token',
      Authorization: 'Bearer artist-token',
      'Content-Type': 'application/json',
    });
  });
  it('refuses a citation absent from the returned evidence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ...fixture.answer, sources: [] }),
    );
    expect((await POST(request())).status).toBe(503);
  });
  it('does not expose provider errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('secret upstream details', { status: 502 }),
    );
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret');
  });
  it('preserves a bounded retry delay', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 429, headers: { 'Retry-After': '20' } }),
    );
    expect((await POST(request())).headers.get('Retry-After')).toBe('20');
  });
});
