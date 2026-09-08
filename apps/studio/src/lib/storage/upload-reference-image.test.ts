// @vitest-environment node
// A storage call, on the server, holding raw bytes.

import { describe, expect, it, vi } from 'vitest';
import {
  ACCESS_TOKEN,
  CHECKSUM,
  OWNER_ID,
  PROJECT_ID,
  STORAGE_KEY,
  SUPABASE_URL,
} from './delete-project.fixtures';
import { deleteReferenceImageObject, uploadReferenceImage } from './upload-reference-image';

vi.mock('server-only', () => ({}));

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

/**
 * The headers of the one request a stub made.
 *
 * Asserts the call happened before reading it. Reaching through an optional chain and then
 * indexing would throw a `TypeError` if the request was never made, which reads as a broken
 * test rather than as the assertion that actually failed.
 */
const headersOfFirstCall = (fetchImpl: typeof fetch): Record<string, string> => {
  const [call] = vi.mocked(fetchImpl).mock.calls;
  expect(call, 'no request was made').toBeDefined();
  return (call[1]?.headers ?? {}) as Record<string, string>;
};

const upload = (response: Response, storageKey = STORAGE_KEY) => {
  const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;
  return {
    fetchImpl,
    run: () =>
      uploadReferenceImage({
        supabaseUrl: SUPABASE_URL,
        accessToken: ACCESS_TOKEN,
        storageKey,
        bytes: BYTES,
        contentType: 'image/jpeg',
        fetchImpl,
      }),
  };
};

// @trace flow=intake.project-intent category=security
describe('keys that are not ours', () => {
  it.each([
    ['an uppercase owner id', `${OWNER_ID.toUpperCase()}/${PROJECT_ID}/${CHECKSUM}`],
    ['a traversal segment', `${OWNER_ID}/../${CHECKSUM}`],
    ['too few segments', `${OWNER_ID}/${CHECKSUM}`],
    ['a checksum that is not one', `${OWNER_ID}/${PROJECT_ID}/not-a-checksum`],
  ])('refuses %s before any request leaves the process', async (_label, key) => {
    const { fetchImpl, run } = upload(new Response(null, { status: 200 }), key);
    await expect(run()).resolves.toEqual({ ok: false, reason: 'invalid-key', status: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses the same keys on the way back out', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const removed = await deleteReferenceImageObject({
      supabaseUrl: SUPABASE_URL,
      accessToken: ACCESS_TOKEN,
      storageKey: `${OWNER_ID}/../${CHECKSUM}`,
      fetchImpl,
    });
    expect(removed).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// @trace flow=intake.project-intent category=data
describe('writing the original', () => {
  it('returns the key it wrote', async () => {
    const { run } = upload(new Response(null, { status: 200 }));
    await expect(run()).resolves.toEqual({ ok: true, storageKey: STORAGE_KEY });
  });

  it('never upserts', async () => {
    // The bucket holds originals and FR-105 makes them immutable. An upsert here would be the
    // one code path able to change what a checksum refers to.
    const { fetchImpl, run } = upload(new Response(null, { status: 200 }));
    await run();

    expect(headersOfFirstCall(fetchImpl)['x-upsert']).toBe('false');
  });

  it('sends the content type it was given, not one it guessed', async () => {
    const { fetchImpl, run } = upload(new Response(null, { status: 200 }));
    await run();

    expect(headersOfFirstCall(fetchImpl)['content-type']).toBe('image/jpeg');
  });

  it('presents the artist token and never a service key', async () => {
    const { fetchImpl, run } = upload(new Response(null, { status: 200 }));
    await run();

    expect(headersOfFirstCall(fetchImpl).authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });
});

// @trace flow=intake.project-intent category=data
describe('how storage refusals are read', () => {
  it('reads 409 as a key already claimed', async () => {
    const { run } = upload(new Response(null, { status: 409 }));
    await expect(run()).resolves.toMatchObject({ ok: false, reason: 'already-claimed' });
  });

  it.each([400, 401, 403])('reads %i as denied', async (status) => {
    // 400 is in here because the RLS claim-guard answers 400 for a key a row already cites.
    const { run } = upload(new Response(null, { status }));
    await expect(run()).resolves.toMatchObject({ ok: false, reason: 'denied' });
  });

  it('reads a server error as unavailable', async () => {
    const { run } = upload(new Response(null, { status: 503 }));
    await expect(run()).resolves.toMatchObject({ ok: false, reason: 'unavailable', status: 503 });
  });

  it('reads a connection failure as unavailable rather than as a refusal', async () => {
    // "We could not ask" must never read as "you may not have it" — the same distinction
    // `signed-url.ts` makes.
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(
      uploadReferenceImage({
        supabaseUrl: SUPABASE_URL,
        accessToken: ACCESS_TOKEN,
        storageKey: STORAGE_KEY,
        bytes: BYTES,
        contentType: 'image/jpeg',
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: false, reason: 'unavailable', status: 0 });
  });
});

// @trace flow=intake.project-intent category=data
describe('taking an orphaned object back out', () => {
  const remove = (response: Response | Error) => {
    const fetchImpl = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }) as unknown as typeof fetch;
    return deleteReferenceImageObject({
      supabaseUrl: SUPABASE_URL,
      accessToken: ACCESS_TOKEN,
      storageKey: STORAGE_KEY,
      fetchImpl,
    });
  };

  it.each([200, 400, 404])('treats %i as removed', async (status) => {
    // Storage answers an already-absent key with 400 as readily as 404, and "it is not there"
    // is success for a removal.
    await expect(remove(new Response(null, { status }))).resolves.toBe(true);
  });

  it('reports a server error as not removed', async () => {
    await expect(remove(new Response(null, { status: 500 }))).resolves.toBe(false);
  });

  it('reports a connection failure as not removed rather than throwing', async () => {
    // The caller is already unwinding a failed request; a throw here would replace the real
    // error with an unhandled rejection from the tidy-up.
    await expect(remove(new TypeError('fetch failed'))).resolves.toBe(false);
  });
});
