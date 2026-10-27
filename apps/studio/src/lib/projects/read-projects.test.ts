// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { readProjects } = await import('./read-projects');
const row = {
  id: 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa',
  title: null,
  created_at: '2026-10-27T18:00:00Z',
  intent: { medium: 'oil', time_budget_minutes: 90 },
  source_images: { storage_key: 'owner/project/photo', original_filename: 'canal.jpg' },
  runs: [{ status: 'succeeded' }],
};
const request = {
  supabaseUrl: 'http://supabase.test/',
  anonKey: 'anon',
  accessToken: 'artist-token',
};

// @trace flow=intake.project-intent category=security
describe('saved project reads', () => {
  it('reads projects and embedded relations as the artist, newest first', async () => {
    const fetchImpl = vi.fn(async () => Response.json([row]));
    expect(await readProjects({ ...request, fetchImpl })).toEqual({
      ok: true,
      projects: [row],
      hasNext: false,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const query = new URL(url).searchParams;
    expect(query.get('runs.limit')).toBe('1');
    expect(query.get('runs.order')).toBe('created_at.desc');
    expect(query.get('order')).toBe('created_at.desc,id.desc');
    expect(init.headers).toEqual({ apikey: 'anon', authorization: 'Bearer artist-token' });
    expect(init.cache).toBe('no-store');
  });
  it('bounds each page and detects another page without loading every project', async () => {
    const fetchImpl = vi.fn(async () => Response.json(Array.from({ length: 25 }, () => row)));
    const result = await readProjects({ ...request, page: 2, fetchImpl });
    expect(result.ok && result.projects).toHaveLength(24);
    expect(result.ok && result.hasNext).toBe(true);
    expect(
      new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]).searchParams.get('offset'),
    ).toBe('24');
  });
  it.each([401, 500])('shows unavailability for HTTP %s', async (status) => {
    expect(
      await readProjects({ ...request, fetchImpl: async () => new Response(null, { status }) }),
    ).toEqual({ ok: false });
  });
  it('refuses malformed results and network failure', async () => {
    expect(
      await readProjects({
        ...request,
        fetchImpl: async () => Response.json([{ ...row, id: 'bad' }]),
      }),
    ).toEqual({ ok: false });
    expect(
      await readProjects({
        ...request,
        fetchImpl: async () => {
          throw new Error('offline');
        },
      }),
    ).toEqual({ ok: false });
  });
});
