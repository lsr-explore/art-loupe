/**
 * Where an artist's reference photograph lives in Supabase Storage, and how it is named.
 *
 * The key format is `{ownerId}/{projectId}/{checksum}`, and every segment of it is load
 * bearing:
 *
 * - The **first** segment is what the storage policies match on. `storage.objects` is one
 *   table shared by every bucket, and the policies added in
 *   `supabase/migrations/20260905183000_create_projects_and_reference_images.sql` read
 *   `(storage.foldername(name))[1] = auth.uid()::text`. A key built any other way is a key
 *   the artist who owns it cannot read.
 * - The **last** segment is the FR-105 content checksum, and `source_images` carries a check
 *   constraint requiring the stored key to end in the row's own checksum. That is what stops
 *   the bytes in the bucket and the checksum every derivative cites from drifting apart.
 *
 * Because the format is a security boundary rather than a convenience, both identifiers are
 * validated as UUIDs before they are interpolated. A project id carrying `../` would
 * otherwise walk out of the artist's own prefix.
 */

import { CHECKSUM_PATTERN } from './checksum';

/**
 * The private bucket holding original uploads.
 *
 * Created by the migration named above, with `public = false`, a 25 MB limit, and the FR-101
 * MIME allow-list. Changing this string means changing the migration too.
 */
export const REFERENCE_IMAGE_BUCKET = 'reference-images';

/** RFC 4122 shape, any version. Postgres accepts these as `uuid`; nothing else is a key. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The three identifiers a reference-image key is made of. */
export interface ReferenceImageKeyParts {
  /** The artist's Supabase user id. Becomes the prefix the storage policies match on. */
  ownerId: string;
  projectId: string;
  /** Lowercase hex SHA-256 of the original bytes (FR-105). */
  checksum: string;
}

/**
 * Build the object key for an original upload.
 *
 * Throws rather than returning a fallback: there is no safe default key, and a caller that
 * ignored an error result would write an object into a prefix its owner cannot reach.
 */
export const buildReferenceImageKey = ({
  ownerId,
  projectId,
  checksum,
}: ReferenceImageKeyParts): string => {
  if (!UUID_PATTERN.test(ownerId)) {
    throw new Error('ownerId must be a UUID — it is the storage prefix the RLS policy matches');
  }
  if (!UUID_PATTERN.test(projectId)) {
    throw new Error('projectId must be a UUID');
  }
  if (!CHECKSUM_PATTERN.test(checksum)) {
    throw new Error('checksum must be lowercase hex SHA-256 (FR-105)');
  }

  return `${ownerId.toLowerCase()}/${projectId.toLowerCase()}/${checksum}`;
};

/**
 * Read a key back into its parts, or `null` if it is not one of ours.
 *
 * `null` rather than a throw, because the input here is a string that arrived from outside —
 * a request parameter, a stored row, a signed URL being re-checked — and "this is not a
 * reference-image key" is an ordinary answer rather than a programming error.
 *
 * It accepts exactly what `buildReferenceImageKey` produces, which is stricter than "the three
 * segments look right": an uppercase UUID passes the pattern but would not match
 * `auth.uid()::text` in the storage policy, so a key spelled that way is not a key this system
 * ever wrote and is refused here rather than being handed on to be denied later.
 */
export const parseReferenceImageKey = (key: string): ReferenceImageKeyParts | null => {
  const segments = key.split('/');
  if (segments.length !== 3) {
    return null;
  }

  const [ownerId, projectId, checksum] = segments;
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(projectId)) {
    return null;
  }
  if (!CHECKSUM_PATTERN.test(checksum)) {
    return null;
  }
  if (buildReferenceImageKey({ ownerId, projectId, checksum }) !== key) {
    return null;
  }

  return { ownerId, projectId, checksum };
};
