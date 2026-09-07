/**
 * Fixtures for the read-through image route.
 *
 * The key here is a *real* one — it satisfies `parseReferenceImageKey`, which is stricter than
 * "three segments": both UUIDs must be lowercase RFC 4122 and the last segment must be a
 * lowercase hex SHA-256. A key that merely looks plausible would be rejected before any of the
 * behaviour under test ran, and every case would pass for the wrong reason.
 */

// Hex *letters*, deliberately. An all-digit UUID uppercases to itself, which would make
// `WRONG_CASE_KEY_SEGMENTS` below identical to the valid key and the case-rejection test
// vacuous — it would assert nothing while appearing to pass.
export const OWNER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const PROJECT_ID = 'ffffffff-1111-4222-8333-444444444444';
export const CHECKSUM = 'a'.repeat(64);

export const VALID_KEY_SEGMENTS = [OWNER_ID, PROJECT_ID, CHECKSUM];
export const VALID_STORAGE_KEY = VALID_KEY_SEGMENTS.join('/');

/** Uppercase UUID: passes a loose pattern, but is not a key this system ever wrote. */
export const WRONG_CASE_KEY_SEGMENTS = [OWNER_ID.toUpperCase(), PROJECT_ID, CHECKSUM];

/** A traversal attempt, which must never reach Storage. */
export const TRAVERSAL_KEY_SEGMENTS = [OWNER_ID, '..', CHECKSUM];

export const SUPABASE_URL = 'http://127.0.0.1:54321';
export const ACCESS_TOKEN = 'artist-access-token';
export const SIGNED_URL = `${SUPABASE_URL}/storage/v1/object/sign/reference-images/x?token=y`;

export const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

/** An upstream Storage response carrying the object. */
export const upstreamResponse = (contentType: string | null): Response =>
  new Response(IMAGE_BYTES, {
    status: 200,
    headers: contentType === null ? {} : { 'content-type': contentType },
  });
