/**
 * Read-through delivery of one reference photograph.
 *
 * The bytes live in a **private** bucket, so the browser cannot fetch them directly and must
 * not be handed a signed URL to do it with. `signed-url.ts` states the reason: a signed URL is
 * a bearer credential, and putting one in an `<img src>` publishes it to the DOM, the referrer
 * chain, and every logging surface in between. Serving through this route instead keeps
 * `img-src` at `'self'` — the CSP is never widened, which is the commitment the storage design
 * was built around.
 *
 * The route mints the URL with the **artist's own token**, never `service_role`. Postgres
 * answers the ownership question through the storage policies, once, in the place it is already
 * answered for every other read. This handler therefore contains no ownership logic of its own,
 * and deliberately so: a second copy of that rule here could disagree with the first.
 */

import { getAccessToken } from '@artloupe/auth/server';
import { ACCEPTED_MIME_TYPES, type AcceptedMimeType } from '@artloupe/schemas';
import type { NextRequest } from 'next/server';
import { env } from '@/env';
import { notFound } from '@/lib/api/responses';
import { parseReferenceImageKey } from '@/lib/storage/reference-images';
import { createReferenceImageSignedUrl } from '@/lib/storage/signed-url';

/**
 * How long a browser may reuse the bytes.
 *
 * `private` because this is one artist's photograph: a shared cache holding it would serve it
 * to whoever asked next. The original is immutable (FR-105) and its checksum is in the key, so
 * the content at a given URL can never change and a long max-age is safe.
 */
const CACHE_CONTROL = 'private, max-age=3600, immutable';

const isAcceptedMimeType = (value: string | null): value is AcceptedMimeType =>
  value !== null && (ACCEPTED_MIME_TYPES as readonly string[]).includes(value);

export const GET = async (
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) => {
  // Next 16 hands route params as a promise; awaiting it is required, not stylistic.
  const { key: segments } = await params;
  const storageKey = segments.join('/');

  // A key that is not one of ours never reaches Storage. RLS would refuse it anyway, but a
  // crafted key has no business being interpolated into a URL path, and refusing here means a
  // traversal attempt does not leave the process.
  if (parseReferenceImageKey(storageKey) === null) {
    return notFound();
  }

  if (!env.SUPABASE_URL) {
    // No Supabase configured means no storage to read. Not a 500: the caller can do nothing
    // with the difference, and this is the ordinary state under `AUTH_PROVIDER=demo`.
    return notFound();
  }

  // A demo session carries no Supabase tokens, so it owns no storage objects. `not_found` is
  // the honest answer — there is genuinely nothing this principal can reach — and it keeps the
  // hermetic e2e run from needing a real bucket.
  const accessToken = await getAccessToken();
  if (accessToken === null) {
    return notFound();
  }

  const signed = await createReferenceImageSignedUrl({
    supabaseUrl: env.SUPABASE_URL,
    accessToken,
    storageKey,
  });

  if (!signed.ok) {
    // `denied` and `not-found` collapse to one answer on purpose: an artist must not be able
    // to tell another artist's object from a nonexistent one. `unavailable` is kept apart,
    // because "we could not ask right now" is not an authorization outcome.
    if (signed.reason === 'unavailable') {
      return new Response(null, { status: 502 });
    }
    return notFound();
  }

  const upstream = await fetch(signed.url);
  if (!upstream.ok || upstream.body === null) {
    return new Response(null, { status: 502 });
  }

  // The upstream content-type is clamped to the FR-101 allow-list rather than reflected. An
  // object stored as `text/html` — however it got there — would otherwise be rendered as a
  // document on this origin, which is same-origin script execution against the artist's own
  // session. Anything unrecognised is served as opaque bytes instead.
  const upstreamType = upstream.headers.get('content-type');
  const contentType = isAcceptedMimeType(upstreamType) ? upstreamType : 'application/octet-stream';

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': CACHE_CONTROL,
      // Belt and braces with the clamp above: never let a sniffing browser reach its own
      // conclusion about what these bytes are.
      'x-content-type-options': 'nosniff',
      // The bytes are a photograph, never a document. Nothing should frame or download-render
      // this response as active content.
      'content-disposition': 'inline',
    },
  });
};
