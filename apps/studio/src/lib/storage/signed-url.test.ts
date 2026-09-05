import { describe, expect, it, vi } from 'vitest';

// `server-only` throws outside a React Server Component; the module under test is server code
// either way, so the marker is stubbed rather than the behaviour changed.
vi.mock('server-only', () => ({}));

import { buildReferenceImageKey } from './reference-images';
import {
  createReferenceImageSignedUrl,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  MAX_SIGNED_URL_TTL_SECONDS,
  MIN_SIGNED_URL_TTL_SECONDS,
  type SignedUrlFailure,
} from './signed-url';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ACCESS_TOKEN = 'artist-access-token';
const STORAGE_KEY = buildReferenceImageKey({
  ownerId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  checksum: 'd'.repeat(64),
});

const signedResponse = (path: string): Response =>
  new Response(JSON.stringify({ signedURL: path }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const errorResponse = (status: number): Response =>
  new Response(JSON.stringify({ error: 'nope' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// @trace flow=intake.project-intent category=security
describe('createReferenceImageSignedUrl', () => {
  it("signs with the artist's own bearer token, so RLS is what decides", async () => {
    const fetchImpl = vi.fn(async () => signedResponse('/object/sign/reference-images/k?token=t'));

    await createReferenceImageSignedUrl({
      supabaseUrl: SUPABASE_URL,
      accessToken: ACCESS_TOKEN,
      storageKey: STORAGE_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    // The failure this guards against is signing as `service_role`, which bypasses RLS and
    // would hand any signed-in caller a working URL for any artist's upload.
    expect(JSON.stringify(headers)).not.toContain('service_role');
  });

  it('posts to the sign endpoint for the reference-images bucket', async () => {
    const fetchImpl = vi.fn(async () => signedResponse('/object/sign/reference-images/k?token=t'));

    await createReferenceImageSignedUrl({
      supabaseUrl: `${SUPABASE_URL}/`,
      accessToken: ACCESS_TOKEN,
      storageKey: STORAGE_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [endpoint, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];

    expect(endpoint).toBe(`${SUPABASE_URL}/storage/v1/object/sign/reference-images/${STORAGE_KEY}`);
    expect(init.method).toBe('POST');
  });

  it('returns an absolute URL built from the relative path storage answers with', async () => {
    const fetchImpl = vi.fn(async () =>
      signedResponse('/object/sign/reference-images/key?token=abc'),
    );

    const result = await createReferenceImageSignedUrl({
      supabaseUrl: SUPABASE_URL,
      accessToken: ACCESS_TOKEN,
      storageKey: STORAGE_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: true,
      url: `${SUPABASE_URL}/storage/v1/object/sign/reference-images/key?token=abc`,
      expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
    });
  });

  it('never issues a request for a key that is not one of ours', async () => {
    const fetchImpl = vi.fn(async () => signedResponse('/object/sign/x?token=t'));

    const result = await createReferenceImageSignedUrl({
      supabaseUrl: SUPABASE_URL,
      accessToken: ACCESS_TOKEN,
      storageKey: '../../etc/passwd',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid-key', status: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each<[string, number, number]>([
    ['above the ceiling', 86_400, MAX_SIGNED_URL_TTL_SECONDS],
    ['below the floor', 1, MIN_SIGNED_URL_TTL_SECONDS],
    ['zero', 0, MIN_SIGNED_URL_TTL_SECONDS],
    ['negative', -60, MIN_SIGNED_URL_TTL_SECONDS],
    ['not a number', Number.NaN, DEFAULT_SIGNED_URL_TTL_SECONDS],
    ['within range', 120, 120],
  ])('clamps a lifetime %s', async (_label, requested, expected) => {
    const fetchImpl = vi.fn(async () => signedResponse('/object/sign/reference-images/k?token=t'));

    const result = await createReferenceImageSignedUrl({
      supabaseUrl: SUPABASE_URL,
      accessToken: ACCESS_TOKEN,
      storageKey: STORAGE_KEY,
      expiresInSeconds: requested,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];

    expect(JSON.parse(String(init.body))).toEqual({ expiresIn: expected });
    expect(result.ok && result.expiresInSeconds).toBe(expected);
  });

  it.each<[string, number, SignedUrlFailure]>([
    ['401', 401, 'denied'],
    ['403', 403, 'denied'],
    ['400', 400, 'not-found'],
    ['404', 404, 'not-found'],
    ['500', 500, 'unavailable'],
    ['503', 503, 'unavailable'],
  ])('maps a %s answer to %s', async (_label, status, reason) => {
    const fetchImpl = vi.fn(async () => errorResponse(status));

    const result = await createReferenceImageSignedUrl({
      supabaseUrl: SUPABASE_URL,
      accessToken: ACCESS_TOKEN,
      storageKey: STORAGE_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: false, reason, status });
  });

  it('reports a network failure as unavailable, not as a refusal', async () => {
    // "We could not ask" must not read to the caller as "you may not have this" — the same
    // distinction `python/libs/auth` draws between a 503 and a 401.
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection reset');
    });

    const result = await createReferenceImageSignedUrl({
      supabaseUrl: SUPABASE_URL,
      accessToken: ACCESS_TOKEN,
      storageKey: STORAGE_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: false, reason: 'unavailable', status: 0 });
  });

  it('refuses a success payload that carries no signed path', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ signedURL: '' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const result = await createReferenceImageSignedUrl({
      supabaseUrl: SUPABASE_URL,
      accessToken: ACCESS_TOKEN,
      storageKey: STORAGE_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: false, reason: 'unavailable', status: 200 });
  });
});
