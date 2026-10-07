// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RUN_ID, streamOf, SUCCESSFUL_RUN, textOf } from '@/lib/runs/run-events.fixtures';

const getAccessToken = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
const agentRequest = vi.hoisted(() => vi.fn());
const env = vi.hoisted(() => ({
  ARTLOUPE_AGENT_URL: 'http://127.0.0.1:8080' as string | undefined,
}));

vi.mock('server-only', () => ({}));
vi.mock('@artloupe/auth/server', () => ({ getAccessToken }));
vi.mock('@/lib/runs/agent-request', () => ({ agentRequest }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/env', () => ({ env }));

const { GET } = await import('./route');

const follow = (id = RUN_ID, headers: Record<string, string> = {}) =>
  GET(new Request(`http://studio/api/runs/${id}/events`, { headers }) as never, {
    params: Promise.resolve({ id }),
  });

const agentStream = () =>
  new Response(streamOf(SUCCESSFUL_RUN), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  env.ARTLOUPE_AGENT_URL = 'http://127.0.0.1:8080';
  getAccessToken.mockResolvedValue('artist-token');
  agentRequest.mockResolvedValue(agentStream());
});

// @trace flow=intake.project-intent category=functionality
describe('following a run', () => {
  it('streams the validated events as SSE', async () => {
    const response = await follow();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    const text = await textOf(response.body as ReadableStream<Uint8Array>);
    expect(text).toContain('id: 4\nevent: succeeded\n');
  });

  it('forwards a numeric Last-Event-ID so a reconnect resumes', async () => {
    await follow(RUN_ID, { 'Last-Event-ID': '3' });
    expect(agentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/runs/${RUN_ID}/events`,
        headers: { 'Last-Event-ID': '3' },
      }),
    );
  });

  it('drops a Last-Event-ID that is not a sequence number', async () => {
    await follow(RUN_ID, { 'Last-Event-ID': '3; DROP' });
    expect(agentRequest).toHaveBeenCalledWith(expect.objectContaining({ headers: {} }));
  });

  it('passes a 204 on, which tells EventSource to stop reconnecting', async () => {
    agentRequest.mockResolvedValue(new Response(null, { status: 204 }));
    expect((await follow()).status).toBe(204);
  });

  it('answers 503 when the agent cannot be reached', async () => {
    agentRequest.mockRejectedValue(new TypeError('fetch failed'));
    expect((await follow()).status).toBe(503);
  });
});

// @trace flow=intake.project-intent category=security
describe('the ownership boundary', () => {
  it('answers 404 for an id that is not a UUID, without asking the agent', async () => {
    expect((await follow('../../health')).status).toBe(404);
    expect(agentRequest).not.toHaveBeenCalled();
  });

  it("passes the agent's 404 on, so another artist's run looks absent", async () => {
    agentRequest.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await follow()).status).toBe(404);
  });

  it('answers 404 with no token', async () => {
    getAccessToken.mockResolvedValue(null);
    expect((await follow()).status).toBe(404);
  });
});
