// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { readProject } = await import('./read-project');

const PROJECT_ID = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
const RUN_ID = '7d1f3a2c-5b6e-4c8d-9e0f-1a2b3c4d5e6f';

type Rows = Record<string, unknown>[];

/** A PostgREST stand-in that answers by table, and records every request it was sent. */
const postgrest = (
  tables: { projects?: Rows; source_images?: Rows; runs?: Rows },
  status = 200,
) => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: init?.headers as Record<string, string> });
    const table = new URL(url).pathname.split('/').pop() as keyof typeof tables;
    return Response.json(status === 200 ? (tables[table] ?? []) : { message: 'no' }, { status });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
};

const read = (fetchImpl: typeof fetch) =>
  readProject({
    supabaseUrl: 'http://127.0.0.1:54321/',
    anonKey: 'anon',
    accessToken: 'artist-token',
    projectId: PROJECT_ID,
    fetchImpl,
  });

// @trace flow=intake.project-intent category=functionality
describe('reading a project for its page', () => {
  it('returns the intent, the original and the latest run', async () => {
    const { fetchImpl } = postgrest({
      projects: [{ id: PROJECT_ID, intent: { medium: 'graphite' } }],
      source_images: [{ storage_key: 'o/p/c', width_px: 1600, height_px: 1200 }],
      runs: [{ id: RUN_ID, status: 'running' }],
    });

    expect(await read(fetchImpl)).toEqual({
      ok: true,
      project: {
        projectId: PROJECT_ID,
        intent: { medium: 'graphite' },
        original: { storageKey: 'o/p/c', widthPx: 1600, heightPx: 1200 },
        latestRun: { runId: RUN_ID, status: 'running' },
      },
    });
  });

  it('has no original and no run before either exists', async () => {
    const { fetchImpl } = postgrest({ projects: [{ id: PROJECT_ID, intent: null }] });
    const result = await read(fetchImpl);
    expect(result.ok && result.project.original).toBeNull();
    expect(result.ok && result.project.latestRun).toBeNull();
  });

  it('asks only for the newest run', async () => {
    const { calls, fetchImpl } = postgrest({ projects: [{ id: PROJECT_ID, intent: null }] });
    await read(fetchImpl);
    const runs = calls.find((call) => call.url.includes('/runs?'));
    expect(runs?.url).toContain('order=created_at.desc');
    expect(runs?.url).toContain('limit=1');
  });

  it('answers unavailable when the connection is refused', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await read(fetchImpl)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('answers unavailable when a body is not JSON', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html>gateway</html>', { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await read(fetchImpl)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('answers unavailable when PostgREST fails', async () => {
    const { fetchImpl } = postgrest({}, 500);
    expect(await read(fetchImpl)).toEqual({ ok: false, reason: 'unavailable' });
  });
});

// @trace flow=intake.project-intent category=security
describe('the ownership boundary', () => {
  it('reads with the artist token and the anon key, never anything else', async () => {
    const { calls, fetchImpl } = postgrest({ projects: [{ id: PROJECT_ID, intent: null }] });
    await read(fetchImpl);
    for (const call of calls) {
      expect(call.headers).toEqual({ apikey: 'anon', authorization: 'Bearer artist-token' });
    }
  });

  it('answers not-found when RLS hides the project', async () => {
    const { fetchImpl } = postgrest({ projects: [] });
    expect(await read(fetchImpl)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('answers not-found, not unavailable, for a token Supabase refuses', async () => {
    const { fetchImpl } = postgrest({}, 401);
    expect(await read(fetchImpl)).toEqual({ ok: false, reason: 'not-found' });
  });
});
