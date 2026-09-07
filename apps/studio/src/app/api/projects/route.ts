/**
 * Create one project from an uploaded reference photograph and a stated intent.
 *
 * The gate above this handler establishes only that the caller is an artist on this surface.
 * Everything about *whose* project this becomes is decided below, by RLS, against the artist's
 * own token — the same arrangement as the DELETE handler in `[id]/route.ts`.
 *
 * This file is deliberately thin. Ordering, compensation and the storage/PostgREST calls live
 * in `@/lib/intake/ingest-upload`; what is here is HTTP: read the multipart body, validate the
 * parts against the shared contract, and map one result union onto status codes.
 *
 * **The bytes cross this boundary in memory.** FR-101 caps an upload at 25 MB and the checksum
 * has to be computed over exactly the bytes that get stored, so there is nothing to stream to.
 * The cap is enforced twice — once on the declared part size before reading, and again on the
 * buffer's real length inside `inspectImage` — because a multipart part's advertised size is a
 * client's claim like any other.
 */

import { subjectFromAccessToken } from '@artloupe/auth';
import { getAccessToken } from '@artloupe/auth/server';
import { MAX_UPLOAD_BYTES, projectIntentSchema } from '@artloupe/schemas';
import type { NextRequest } from 'next/server';
import { env } from '@/env';
import { conflict, invalidUpload, notFound, unauthenticated } from '@/lib/api/responses';
import { ingestUpload } from '@/lib/intake/ingest-upload';
import { logger } from '@/lib/logger';

/** The multipart field names this handler reads. Anything else in the body is ignored. */
const FILE_FIELD = 'file';
const INTENT_FIELD = 'intent';

export const POST = async (request: NextRequest) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return notFound();
  }

  // A demo session carries no Supabase tokens, so it owns no project to attach an upload to.
  const accessToken = await getAccessToken();
  if (accessToken === null) {
    return unauthenticated();
  }

  // The storage key's leading segment is what the storage policies match on, so the upload
  // path needs the artist's Supabase user id. See `claims.ts` for why reading the claim is
  // safe here and why a wrong answer is a refused write rather than a crossed boundary.
  const ownerId = subjectFromAccessToken(accessToken);
  if (ownerId === null) {
    return unauthenticated();
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Not a parseable multipart body at all — malformed rather than unacceptable, which is the
    // one case in this handler that really is a 400. `invalid_upload` reports it as
    // `missing_file` because from the artist's side there is no file here either way.
    return invalidUpload('missing_file');
  }

  const file = form.get(FILE_FIELD);
  if (!(file instanceof File) || file.size === 0) {
    return invalidUpload('missing_file');
  }

  // Checked before the body is read into memory. `inspectImage` checks the real length again;
  // this one only avoids buffering 200 MB to then refuse it.
  if (file.size > MAX_UPLOAD_BYTES) {
    return invalidUpload('too_large');
  }

  const intent = parseIntent(form.get(INTENT_FIELD));
  if (intent === null) {
    return invalidUpload('invalid_intent');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const ingested = await ingestUpload({
    supabaseUrl: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    accessToken,
    ownerId,
    // UNTRUSTED (FR-106). Stored for provenance and screened; it never reaches the object key,
    // which is built from ids and a checksum precisely so a filename cannot shape a path.
    filename: file.name,
    bytes,
    intent,
    fetchImpl: fetch,
  });

  if (!ingested.ok) {
    const { failure } = ingested;
    if (failure.kind === 'rejected') {
      return invalidUpload(failure.reason);
    }
    if (failure.kind === 'duplicate') {
      return conflict();
    }
    logger.error({ status: failure.status }, 'ingest failed before the project was complete');
    return Response.json({ error: 'ingest_unavailable' }, { status: 502 });
  }

  const { projectId, checksum, detections } = ingested.result;

  // Logged, not returned as prose. The count and the rule ids are safe to emit; the excerpts
  // are attacker-controlled text and belong only in the table an operator reads deliberately.
  if (detections.length > 0) {
    logger.warn(
      {
        projectId,
        detections: detections.map(({ surface, ruleId, severity }) => ({
          surface,
          ruleId,
          severity,
        })),
      },
      'screening recorded detections on an upload',
    );
  }

  // 201 with the identity of what was made. No signed URL: the app reads originals back
  // through the image route so `img-src` stays `'self'` and the CSP is never widened.
  return Response.json({ projectId, checksum }, { status: 201 });
};

/**
 * Read the `intent` part and validate it against the shared contract.
 *
 * `null` for every failure — absent, not a string, not JSON, or JSON that the schema refuses.
 * The artist's next move is the same in all four cases, and the reason vocabulary in
 * `responses.ts` is closed on purpose, so a Zod error message must not leak out through it.
 */
const parseIntent = (raw: FormDataEntryValue | null) => {
  if (typeof raw !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = projectIntentSchema.safeParse(parsed);
  return result.success ? result.data : null;
};
