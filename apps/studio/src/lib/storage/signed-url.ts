import 'server-only';

/**
 * A short-lived URL for one original upload, minted with the artist's own token.
 *
 * The reason it is the artist's token and not the service-role key is the whole point of the
 * helper. Signing as `service_role` would bypass RLS, and the storage policies added in
 * `supabase/migrations/20260905183000_create_projects_and_reference_images.sql` would stop
 * deciding anything: any signed-in caller could ask for any artist's object and get a working
 * URL back. Relaying the artist's Supabase-issued JWT (ADR 0002) means Postgres answers the
 * ownership question, once, in the place it is already answered for every other read.
 *
 * What the URL is *for*: handing the agent layer access to bytes it must otherwise never hold
 * a credential to reach. The browser does not need one — the apps serve a read-through image
 * route so `img-src` stays `'self'` and the CSP is never widened.
 *
 * There is no HTTP path in this pull request. This module is the seam PR 6 and PR 7 call into.
 */

import { parseReferenceImageKey, REFERENCE_IMAGE_BUCKET } from './reference-images';

/**
 * Default lifetime of a signed URL, in seconds.
 *
 * Short because the URL is a bearer credential: anyone holding it reads the object, with no
 * further check. A minute is enough for a server-to-server fetch and short enough that a URL
 * captured in a log is stale before anyone reads the log.
 */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 60;

/** Hard ceiling. A caller asking for longer gets this, not an error and not what they asked. */
export const MAX_SIGNED_URL_TTL_SECONDS = 300;

/** Floor, so a rounding error or a zero cannot mint a URL that is already expired. */
export const MIN_SIGNED_URL_TTL_SECONDS = 10;

export interface SignedUrlRequest {
  /** Supabase project URL, e.g. `http://127.0.0.1:54321`. */
  supabaseUrl: string;
  /** The artist's Supabase access token, from the encrypted session. Never a service key. */
  accessToken: string;
  /** Object key in the reference-images bucket, as built by `buildReferenceImageKey`. */
  storageKey: string;
  /** Requested lifetime; clamped into `[MIN, MAX]`. */
  expiresInSeconds?: number;
  /** Injection seam for tests. Defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Why a URL was not issued.
 *
 * `denied` and `unavailable` are kept apart for the same reason `python/libs/auth` keeps 401
 * and 503 apart: "you may not have this" and "we could not ask right now" must not read alike
 * to the caller, or a transient Supabase blip looks like an authorization failure.
 */
export type SignedUrlFailure = 'invalid-key' | 'denied' | 'not-found' | 'unavailable';

export type SignedUrlResult =
  | { ok: true; url: string; expiresInSeconds: number }
  | { ok: false; reason: SignedUrlFailure; status: number };

/** Clamp rather than reject: a caller that asked for a week gets five minutes and works. */
const clampTtl = (requested: number | undefined): number => {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_SIGNED_URL_TTL_SECONDS;
  }
  const whole = Math.floor(requested);
  return Math.min(Math.max(whole, MIN_SIGNED_URL_TTL_SECONDS), MAX_SIGNED_URL_TTL_SECONDS);
};

const failureFor = (status: number): SignedUrlFailure => {
  if (status === 401 || status === 403) {
    return 'denied';
  }
  // Storage answers a missing object with 400 as often as 404, and RLS makes "not yours" and
  // "not there" the same observable answer by design — an artist must not be able to probe
  // for the existence of another artist's upload.
  if (status === 400 || status === 404) {
    return 'not-found';
  }
  return 'unavailable';
};

/**
 * Ask Supabase Storage to sign one object.
 *
 * The key is parsed before it is used. Storage RLS would refuse a crafted key anyway, but a
 * key that is not one of ours has no business being interpolated into a URL path at all — and
 * refusing it here means a traversal attempt never leaves the process.
 */
export const createReferenceImageSignedUrl = async ({
  supabaseUrl,
  accessToken,
  storageKey,
  expiresInSeconds,
  fetchImpl = fetch,
}: SignedUrlRequest): Promise<SignedUrlResult> => {
  if (parseReferenceImageKey(storageKey) === null) {
    return { ok: false, reason: 'invalid-key', status: 0 };
  }

  const expiresIn = clampTtl(expiresInSeconds);
  const base = supabaseUrl.replace(/\/+$/, '');
  const endpoint = `${base}/storage/v1/object/sign/${REFERENCE_IMAGE_BUCKET}/${storageKey}`;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expiresIn }),
    });
  } catch {
    // A network failure is "we could not ask", never "you may not have it".
    return { ok: false, reason: 'unavailable', status: 0 };
  }

  if (!response.ok) {
    return { ok: false, reason: failureFor(response.status), status: response.status };
  }

  const payload: unknown = await response.json();
  const signed =
    typeof payload === 'object' && payload !== null
      ? (payload as { signedURL?: unknown }).signedURL
      : undefined;

  if (typeof signed !== 'string' || signed.length === 0) {
    return { ok: false, reason: 'unavailable', status: response.status };
  }

  // Storage returns a path relative to `/storage/v1`, e.g. `/object/sign/bucket/key?token=…`.
  return {
    ok: true,
    url: `${base}/storage/v1${signed.startsWith('/') ? signed : `/${signed}`}`,
    expiresInSeconds: expiresIn,
  };
};
