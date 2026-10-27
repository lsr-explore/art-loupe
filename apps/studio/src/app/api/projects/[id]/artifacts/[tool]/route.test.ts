// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAccessToken = vi.hoisted(() => vi.fn());
const agentRequest = vi.hoisted(() => vi.fn());
vi.mock('@artloupe/auth/server', () => ({ getAccessToken }));
vi.mock('@/lib/runs/agent-request', () => ({ agentRequest }));
vi.mock('@/env', () => ({ env: { ARTLOUPE_AGENT_URL: 'http://127.0.0.1:8080' } }));
const { GET } = await import('./route');
const id = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
const read = (suffix = '', tool = 'grayscale') =>
  GET(new NextRequest(`http://studio/api/projects/${id}/artifacts/${tool}${suffix}`), {
    params: Promise.resolve({ id, tool }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  getAccessToken.mockResolvedValue('artist-token');
  agentRequest.mockImplementation(
    async () =>
      new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }),
  );
});

// @trace flow=intake.project-intent category=security
describe('private study images', () => {
  it('forwards the artist and recipe and returns private PNG bytes', async () => {
    const response = await read('?version=v1&checksum=abc');
    expect(agentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'artist-token',
        path: `/projects/${id}/artifacts/grayscale?version=v1&checksum=abc`,
      }),
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });
  it('serves an attachment only when download is requested', async () => {
    expect((await read('?download=1')).headers.get('content-disposition')).toBe(
      'attachment; filename="grayscale.png"',
    );
    expect((await read()).headers.get('content-disposition')).toBe(
      'inline; filename="grayscale.png"',
    );
  });
  it('refuses missing sessions without contacting the agent', async () => {
    getAccessToken.mockResolvedValue(null);
    expect((await read()).status).toBe(404);
    expect(agentRequest).not.toHaveBeenCalled();
  });
  it('refuses unknown tools without contacting the agent', async () => {
    expect((await read('', '../unknown')).status).toBe(404);
    expect(agentRequest).not.toHaveBeenCalled();
  });
  it.each([401, 404])('preserves upstream refusal %s', async (status) => {
    agentRequest.mockResolvedValue(new Response(null, { status }));
    expect((await read()).status).toBe(status);
  });
  it('does not pass upstream error text or a non-image body to the browser', async () => {
    agentRequest.mockResolvedValue(new Response('private upstream detail'));
    const response = await read();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private upstream detail');
  });
});
