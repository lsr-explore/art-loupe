// @vitest-environment node
// A route handler runs on the server and returns a web `Response`; there is no DOM in it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESS_TOKEN,
  IMAGE_BYTES,
  SIGNED_URL,
  SUPABASE_URL,
  TRAVERSAL_KEY_SEGMENTS,
  upstreamResponse,
  VALID_KEY_SEGMENTS,
  VALID_STORAGE_KEY,
  WRONG_CASE_KEY_SEGMENTS,
} from './route.fixtures';

const getAccessToken = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
const createReferenceImageSignedUrl = vi.hoisted(() => vi.fn());

vi.mock('@artloupe/auth/server', () => ({ getAccessToken }));
vi.mock('@/lib/storage/signed-url', () => ({ createReferenceImageSignedUrl }));
vi.mock('@/env', () => ({ env: { SUPABASE_URL } }));

const { GET } = await import('./route');

const callRoute = async (segments: string[] = VALID_KEY_SEGMENTS): Promise<Response> =>
  GET({} as never, { params: Promise.resolve({ key: segments }) });

const signedOk = () => ({ ok: true, url: SIGNED_URL, expiresInSeconds: 60 });

/**
 * The delivery half of the owner boundary.
 *
 * The route's job is to hold two lines that are easy to cross without noticing: it must never
 * distinguish "not yours" from "not there", and it must never let the bucket decide what the
 * browser treats these bytes as.
 */
// @trace flow=platform.auth category=security
describe('GET /api/images/[...key]', () => {
  beforeEach(() => {
    // `clearAllMocks`, not `restoreAllMocks`: as of Vitest 4 the latter acts only on
    // `vi.spyOn` mocks, so a plain `vi.fn()` keeps its call history and a "was not called"
    // assertion silently inherits the previous test's calls.
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    getAccessToken.mockResolvedValue(ACCESS_TOKEN);
    createReferenceImageSignedUrl.mockResolvedValue(signedOk());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => upstreamResponse('image/jpeg')),
    );
  });

  describe('keys that are not ours', () => {
    it('refuses a traversal attempt without asking Storage', async () => {
      const response = await callRoute(TRAVERSAL_KEY_SEGMENTS);

      expect(response.status).toBe(404);
      // The point of the check: the crafted key never leaves the process. Storage RLS would
      // refuse it too, but only after it had been interpolated into a URL and sent.
      expect(createReferenceImageSignedUrl).not.toHaveBeenCalled();
    });

    it('refuses an uppercase UUID, which no key this system wrote ever carries', async () => {
      const response = await callRoute(WRONG_CASE_KEY_SEGMENTS);

      expect(response.status).toBe(404);
      expect(createReferenceImageSignedUrl).not.toHaveBeenCalled();
    });
  });

  describe('principals with no storage identity', () => {
    it('answers 404 when the session carries no Supabase token', async () => {
      // The `AUTH_PROVIDER=demo` case. A demo session is authenticated but owns no objects,
      // so "there is nothing here for you" is the honest answer rather than a 401 or a 500.
      getAccessToken.mockResolvedValue(null);

      const response = await callRoute();

      expect(response.status).toBe(404);
      expect(createReferenceImageSignedUrl).not.toHaveBeenCalled();
    });
  });

  describe('the ownership boundary', () => {
    it.each(['denied', 'not-found'] as const)(
      'answers 404 when signing fails as %s',
      async (reason) => {
        createReferenceImageSignedUrl.mockResolvedValue({ ok: false, reason, status: 0 });

        const response = await callRoute();

        // Both collapse to one answer on purpose. If `denied` ever produced a 403 while
        // `not-found` produced a 404, the pair would tell an artist which of another artist's
        // project ids are real — the exact probe RLS refuses to allow at the database.
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: 'not_found' });
      },
    );

    it('signs with the artist token, never a service key', async () => {
      await callRoute();

      expect(createReferenceImageSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: ACCESS_TOKEN, storageKey: VALID_STORAGE_KEY }),
      );
    });
  });

  describe('upstream failures', () => {
    it('answers 502 when Storage could not be asked', async () => {
      createReferenceImageSignedUrl.mockResolvedValue({
        ok: false,
        reason: 'unavailable',
        status: 0,
      });

      // Kept apart from the 404s deliberately: "we could not ask right now" is not an
      // authorization outcome, and reporting it as one turns a Supabase blip into a
      // permissions bug report.
      expect((await callRoute()).status).toBe(502);
    });

    it('answers 502 when the signed URL does not resolve', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 500 })),
      );

      expect((await callRoute()).status).toBe(502);
    });

    it('answers 502 when the connection to storage is refused outright', async () => {
      // A reset or timeout rejects the promise rather than resolving with a status. Unguarded,
      // that throw escapes the handler as a generic 500 — reporting a server fault for a
      // transient upstream failure, and losing the retryable answer this branch intends.
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        }),
      );

      expect((await callRoute()).status).toBe(502);
    });
  });

  describe('what the browser is told these bytes are', () => {
    it('serves an accepted type through unchanged', async () => {
      const response = await callRoute();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(IMAGE_BYTES);
    });

    it.each(['text/html', 'application/javascript', 'image/svg+xml'])(
      'clamps %s to opaque bytes rather than reflecting it',
      async (hostileType) => {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => upstreamResponse(hostileType)),
        );

        const response = await callRoute();

        // Reflecting the bucket's content-type would let an object stored as a document be
        // rendered as one on this origin — same-origin script execution against the artist's
        // own session. `image/svg+xml` is in the list because SVG carries script and is *not*
        // an FR-101 accepted type, however much it looks like one.
        expect(response.headers.get('content-type')).toBe('application/octet-stream');
      },
    );

    it('clamps a missing content-type rather than leaving it unset', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => upstreamResponse(null)),
      );

      expect((await callRoute()).headers.get('content-type')).toBe('application/octet-stream');
    });

    it('forbids sniffing and keeps the response out of shared caches', async () => {
      const response = await callRoute();

      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      // `private`, because a shared cache holding one artist's photograph would serve it to
      // whoever asked next.
      expect(response.headers.get('cache-control')).toContain('private');
    });
  });
});
