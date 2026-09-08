import 'server-only';

/**
 * Put one original into the private bucket, and take it back out if the row that should cite
 * it never gets written.
 *
 * **Order is the safety property here, exactly as it is in `delete-project.ts` — and it runs
 * the opposite way.** Deletion removes objects before rows; ingest writes the object before the
 * row. Both orders are forced by the same policy, from its two sides:
 * `artloupe_reference_images_insert_own` in
 * `supabase/migrations/20260906181500_close_storage_object_lifecycle.sql` refuses a write to a
 * key that a `source_images` row already cites. So writing the row first makes *every first
 * upload* fail with a bare permissions error that reads like a broken policy rather than like
 * a caller doing things out of order.
 *
 * A failure between the two steps leaves an object no row cites: invisible to the artist,
 * cleaned up by `deleteReferenceImageObject` on the way out, and — if that cleanup itself fails
 * — harmless, because the key is derived from the content checksum and a retry writes the same
 * bytes to the same key.
 *
 * The credential is the artist's own token, never `service_role`, on the same grounds as every
 * other storage call in this app (ADR 0002).
 */

import {
  buildReferenceImageKey,
  parseReferenceImageKey,
  REFERENCE_IMAGE_BUCKET,
} from './reference-images';

export interface UploadReferenceImageRequest {
  supabaseUrl: string;
  /** The artist's Supabase access token, from the encrypted session. Never a service key. */
  accessToken: string;
  /** Object key in the reference-images bucket, as built by `buildReferenceImageKey`. */
  storageKey: string;
  bytes: Uint8Array;
  /** Sniffed from the bytes by `inspect-image.ts`, never taken from the request. */
  contentType: string;
  fetchImpl?: typeof fetch;
}

/**
 * Why an object was not written.
 *
 * `already-claimed` is the interesting one. Storage refuses a write to a key a row already
 * cites, so this means *this artist has already uploaded these exact bytes to this project* —
 * the key ends in the content checksum. That is a conflict with a meaning, not a fault, and
 * collapsing it into `denied` would tell an artist they lacked permission to do something they
 * had in fact already done.
 */
export type UploadFailure = 'invalid-key' | 'already-claimed' | 'denied' | 'unavailable';

export type UploadReferenceImageResult =
  | { ok: true; storageKey: string }
  | { ok: false; reason: UploadFailure; status: number };

const objectUrl = (base: string, storageKey: string): string =>
  `${base}/storage/v1/object/${REFERENCE_IMAGE_BUCKET}/${storageKey}`;

/**
 * Write the original.
 *
 * The key is re-parsed rather than trusted, the same way `signed-url.ts` re-parses before
 * signing. Storage RLS would refuse a crafted key anyway, but a key that is not one of ours has
 * no business being interpolated into a URL path at all — and refusing it here means a
 * traversal attempt never leaves the process.
 */
export const uploadReferenceImage = async ({
  supabaseUrl,
  accessToken,
  storageKey,
  bytes,
  contentType,
  fetchImpl = fetch,
}: UploadReferenceImageRequest): Promise<UploadReferenceImageResult> => {
  if (parseReferenceImageKey(storageKey) === null) {
    return { ok: false, reason: 'invalid-key', status: 0 };
  }

  const base = supabaseUrl.replace(/\/+$/, '');

  let response: Response;
  try {
    response = await fetchImpl(objectUrl(base, storageKey), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': contentType,
        // Never overwrite. The bucket holds originals, and FR-105 makes them immutable; an
        // upsert here would be the one code path able to change what a checksum refers to.
        'x-upsert': 'false',
      },
      body: bytes as unknown as BodyInit,
    });
  } catch {
    return { ok: false, reason: 'unavailable', status: 0 };
  }

  if (response.ok) {
    return { ok: true, storageKey };
  }

  // 409 is storage's own "this key is taken". The RLS claim-guard answers 400 or 403 for the
  // same situation — a key some row already cites — so all three collapse to one meaning, and
  // the caller decides whether that is a duplicate upload or a genuine refusal by looking at
  // whether *it* owns the row citing the key.
  if (response.status === 409) {
    return { ok: false, reason: 'already-claimed', status: response.status };
  }
  if (response.status === 400 || response.status === 403) {
    return { ok: false, reason: 'denied', status: response.status };
  }
  if (response.status === 401) {
    return { ok: false, reason: 'denied', status: response.status };
  }
  return { ok: false, reason: 'unavailable', status: response.status };
};

/**
 * Remove an object that no row cites — the compensation half of an interrupted ingest.
 *
 * Answers a plain boolean because there is exactly one thing the caller can do with the
 * result: the request that triggered this has already failed, and the response owed to the
 * artist is decided by *that* failure, not by whether the tidy-up succeeded. A leftover object
 * costs some bytes and is overwritten by an identical retry, so it is worth logging and not
 * worth changing the answer for.
 */
export const deleteReferenceImageObject = async ({
  supabaseUrl,
  accessToken,
  storageKey,
  fetchImpl = fetch,
}: Omit<UploadReferenceImageRequest, 'bytes' | 'contentType'>): Promise<boolean> => {
  if (parseReferenceImageKey(storageKey) === null) {
    return false;
  }

  const base = supabaseUrl.replace(/\/+$/, '');

  try {
    const response = await fetchImpl(objectUrl(base, storageKey), {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    // Storage answers an already-absent key with 400 as readily as 404 — the same behaviour
    // `signed-url.ts` records — and "it is not there" is success for a removal.
    return response.ok || response.status === 400 || response.status === 404;
  } catch {
    return false;
  }
};

export { buildReferenceImageKey };
