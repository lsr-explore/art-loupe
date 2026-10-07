// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_ID, RUN_ID } from '@/lib/runs/run-events.fixtures';

const getAccessToken = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
const agentRequest = vi.hoisted(() => vi.fn());
const env = vi.hoisted(() => ({
  ARTLOUPE_AGENT_URL: 'http://127.0.0.1:8080' as string | undefined,
}));

vi.mock('@artloupe/auth/server', () => ({ getAccessToken }));
vi.mock('@/lib/runs/agent-request', () => ({ agentRequest }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/env', () => ({ env }));

const { POST } = await import('./route');

const start = (id = PROJECT_ID) =>
  POST(new Request(`http://studio/api/projects/${id}/runs`, { method: 'POST' }) as never, {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  env.ARTLOUPE_AGENT_URL = 'http://127.0.0.1:8080';
  getAccessToken.mockResolvedValue('artist-token');
  agentRequest.mockResolvedValue(
    Response.json(
      { run_id: RUN_ID, status: 'queued', events: `/runs/${RUN_ID}/events` },
      { status: 202 },
    ),
  );
});

// @trace flow=intake.project-intent category=functionality
describe('starting a run', () => {
  it('answers 202 with the run id', async () => {
    const response = await start();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ runId: RUN_ID });
  });

  it('asks the agent to run this project, as the artist', async () => {
    await start();
    expect(agentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'artist-token',
        path: '/runs',
        method: 'POST',
        body: { project_id: PROJECT_ID },
      }),
    );
  });

  it.each([
    ['the agent is not configured', () => (env.ARTLOUPE_AGENT_URL = undefined)],
    [
      'the agent cannot be reached',
      () => agentRequest.mockRejectedValue(new TypeError('fetch failed')),
    ],
    [
      'the agent refuses with a 503',
      () => agentRequest.mockResolvedValue(new Response(null, { status: 503 })),
    ],
    [
      'the agent returns no usable run id',
      () => agentRequest.mockResolvedValue(Response.json({ run_id: '../x' }, { status: 202 })),
    ],
  ])('answers 503 agent_unavailable when %s', async (_name, arrange) => {
    arrange();
    const response = await start();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'agent_unavailable' });
  });
});

// @trace flow=intake.project-intent category=security
describe('the ownership boundary', () => {
  it('answers 404 for an id that is not a UUID, without asking the agent', async () => {
    const response = await start('not-a-uuid');
    expect(response.status).toBe(404);
    expect(agentRequest).not.toHaveBeenCalled();
  });

  it('answers 404 with no token', async () => {
    getAccessToken.mockResolvedValue(null);
    expect((await start()).status).toBe(404);
    expect(agentRequest).not.toHaveBeenCalled();
  });

  it("passes the agent's 404 on unchanged, so absent and foreign stay one answer", async () => {
    agentRequest.mockResolvedValue(
      Response.json({ detail: 'Project not found.' }, { status: 404 }),
    );
    const response = await start();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it("answers 401 when the agent rejects the artist's token", async () => {
    agentRequest.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await start()).status).toBe(401);
  });
});
