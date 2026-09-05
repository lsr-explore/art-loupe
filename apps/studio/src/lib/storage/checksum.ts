/**
 * The FR-105 content checksum.
 *
 * "The original upload is immutable. Every derivative records the transform parameters and
 * the source checksum that produced it." This is that checksum: lowercase hex SHA-256 of the
 * original bytes, matching `checksumSchema` in `@artloupe/schemas` and the
 * `source_images_checksum_is_sha256` constraint in the migration.
 *
 * It is deliberately the identifier everything downstream keys on. Not the signed URL, which
 * rotates and would miss on every read. Not the bytes, which a multimodal cache entry would
 * store megabytes of. Not the row id, which says nothing about whether the content changed.
 *
 * `node:crypto` rather than Web Crypto: `createHash` is synchronous and streams, the route
 * handlers that will call it run on the Node runtime, and the import itself is the marker
 * that this module never reaches a browser bundle.
 */

import { createHash } from 'node:crypto';

/** Lowercase hex SHA-256. The same shape the database and both schema packages require. */
export const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

/** Whether a string is a well-formed checksum. Shape only — it proves nothing about bytes. */
export const isChecksum = (value: string): boolean => CHECKSUM_PATTERN.test(value);

/**
 * SHA-256 the upload.
 *
 * Synchronous, and that is a real cost: hashing 25 MB — FR-101's ceiling — occupies the event
 * loop for tens of milliseconds. It is accepted here because the route handler is already
 * holding the whole buffer to validate it, so there is nothing to stream from, and because a
 * checksum computed anywhere other than immediately beside the bytes it describes is a
 * checksum that can be wrong.
 */
export const computeChecksum = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
