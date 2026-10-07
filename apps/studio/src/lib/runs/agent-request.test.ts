// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const cloudRunHeaders = vi.hoisted(() =>
  vi.fn(async () => ({ 'X-Serverless-Authorization': 'Bearer id' })),
);
vi.mock('@/lib/inspiration/cloud-run', () => ({ cloudRunHeaders }));

const { agentRequest } = await import('./agent-request');

// @trace flow=platform.auth category=security
describe('a request to the agent', () => {
  it('carries the artist token and the service identity, and refuses redirects', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));

    await agentRequest({
      agentUrl: 'https://agent.run.app',
      accessToken: 'artist-token',
      path: '/runs',
      method: 'POST',
      body: { project_id: 'p' },
      signal: AbortSignal.timeout(1000),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://agent.run.app/runs');
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer artist-token',
      'X-Serverless-Authorization': 'Bearer id',
      'Content-Type': 'application/json',
    });
    expect(init.body).toBe('{"project_id":"p"}');
  });

  it('cannot be pointed off the agent by the path', async () => {
    const fetchImpl = vi.fn(async () => new Response(null));
    await agentRequest({
      agentUrl: 'https://agent.run.app',
      accessToken: 't',
      path: '/runs/x/events',
      signal: AbortSignal.timeout(1000),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url] = fetchImpl.mock.calls[0] as unknown as [URL];
    expect(new URL(String(url)).origin).toBe('https://agent.run.app');
  });
});
