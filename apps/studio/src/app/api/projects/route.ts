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
 * That makes *when* the cap is applied a resource question, not just a validation one, and it is
 * applied three times on the way in:
 *
 * 1. the body itself, **counted as it streams in** and abandoned the moment it passes the
 *    envelope — `request.formData()` buffers the whole request before returning, and Next.js
 *    applies no default body limit to a route handler, so without this an authenticated artist
 *    can make a worker buffer arbitrarily much before being told no;
 * 2. the file part's declared `size`, after parsing;
 * 3. the buffer's real length inside `inspectImage` — because every number a client supplies
 *    about its own request, header or part, is a claim rather than a fact.
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

/**
 * Ceiling on the whole wire body, as opposed to the photograph inside it.
 *
 * The envelope carries the `intent` JSON (a goal is capped at 2000 characters by the schema)
 * plus multipart boundaries and per-part headers. 64 KiB is far more than that needs and far
 * less than a second photograph, so it cannot be used to smuggle payload past the FR-101 cap.
 */
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

/**
 * Read the body, refusing as soon as it passes the ceiling.
 *
 * `request.formData()` buffers the entire request before returning, so a size check that runs
 * on its result has already paid the cost it was meant to prevent — and Next.js applies no
 * default body limit to a route handler, nor does this repo configure an upstream one.
 *
 * **Counting the stream rather than trusting `Content-Length`** is the part that matters. The
 * header is the cheap fast path and is checked first, but it is a claim: an attacker sending an
 * enormous body simply omits it, and refusing every request that lacks one would reject
 * legitimate chunked uploads instead. Counting as the bytes arrive bounds the memory whether
 * the header is honest, absent, or a lie.
 *
 * `null` means "over the ceiling, stop" — the caller turns that into the refusal, and the
 * reader is cancelled so the remainder is never pulled.
 */
const readBoundedBody = async (request: NextRequest): Promise<Uint8Array | null> => {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return null;
  }

  if (request.body === null) {
    return null;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

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

  // Bounded as it arrives, before anything parses it. See `readBoundedBody`.
  const rawBody = await readBoundedBody(request);
  if (rawBody === null) {
    return invalidUpload('too_large');
  }

  let form: FormData;
  try {
    // Re-parsed from the bytes already counted, rather than from the request, so the multipart
    // decode cannot reach past the ceiling the read above enforced.
    form = await new Response(rawBody as unknown as BodyInit, {
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
    }).formData();
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

  // The second of the three checks. `Content-Length` bounded the envelope; this bounds the
  // photograph, and `inspectImage` re-measures the buffer that actually arrived.
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

  const { projectId, checksum, detections, detectionsRecorded } = ingested.result;

  // A bookkeeping failure does not cost the artist a valid upload, but it must not vanish.
  // When this is false the operations panel under-reports, and the OCR not-screened sentinel
  // is missing — which is precisely the row whose absence makes an unscreened surface look
  // clean. Logged at error level because nothing else will ever notice.
  if (!detectionsRecorded) {
    logger.error(
      { projectId, detectionCount: detections.length },
      'screening detections were not recorded for a completed upload',
    );
  }

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
