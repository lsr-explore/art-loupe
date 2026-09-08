/**
 * Fixtures for the upload route.
 *
 * The handler is an HTTP shell over `ingestUpload`, so these fixtures are about the *request*:
 * what a real multipart body looks like, and the ways one can be wrong. The ingest path's own
 * behaviour is covered by `lib/intake/ingest-upload.test.ts` against a call-order-recording
 * stub; here `ingestUpload` is mocked, so nothing in this file needs to be a decodable image.
 */

import type { ProjectIntent } from '@artloupe/schemas';

export const SUPABASE_URL = 'http://127.0.0.1:54321';
export const ANON_KEY = 'anon-key';
export const ACCESS_TOKEN = 'artist-access-token';

export const OWNER_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
export const PROJECT_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
export const CHECKSUM = 'a'.repeat(64);

/**
 * A structurally real JWT carrying `sub`.
 *
 * The handler reads the claim through `subjectFromAccessToken`, which is *not* mocked — a
 * stubbed token would let a broken claim reader pass this suite.
 */
export const ACCESS_TOKEN_WITH_SUBJECT = [
  btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replaceAll('=', ''),
  btoa(JSON.stringify({ sub: OWNER_ID })).replaceAll('=', ''),
  'not-a-signature',
]
  .join('.')
  .replaceAll('+', '-')
  .replaceAll('/', '_');

/** A demo-session token: real JWT shape, no Supabase user behind it. */
export const ACCESS_TOKEN_WITHOUT_SUBJECT = [
  btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replaceAll('=', ''),
  btoa(JSON.stringify({ role: 'authenticated' })).replaceAll('=', ''),
  'not-a-signature',
]
  .join('.')
  .replaceAll('+', '-')
  .replaceAll('/', '_');

export const VALID_INTENT: ProjectIntent = {
  medium: 'graphite',
  time_budget_minutes: 180,
  support: { width: 9, height: 12, units: 'in' },
  skill_level: 'intermediate',
  goal: 'likeness matters more than finish',
};

/** Bytes the handler only ever measures and forwards — `ingestUpload` is mocked here. */
export const FILE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

interface RequestParts {
  file?: File | string | null;
  intent?: string | null;
}

/**
 * Build a POST carrying a multipart body.
 *
 * Uses a real `FormData`, so the handler's `request.formData()` does real work — including
 * rejecting the malformed-body case below, which a hand-written stub would have to fake.
 */
export const uploadRequest = ({ file, intent }: RequestParts = {}): Request => {
  const form = new FormData();

  if (file === undefined) {
    form.set('file', new File([FILE_BYTES as BlobPart], 'canal-study.jpg', { type: 'image/jpeg' }));
  } else if (file !== null) {
    form.set('file', file);
  }

  if (intent === undefined) {
    form.set('intent', JSON.stringify(VALID_INTENT));
  } else if (intent !== null) {
    form.set('intent', intent);
  }

  return new Request('http://localhost:3001/api/projects', { method: 'POST', body: form });
};

/** A request whose body is not multipart at all, so `formData()` throws. */
export const malformedRequest = (): Request =>
  new Request('http://localhost:3001/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=nope' },
    body: 'not actually multipart',
  });

/**
 * A request whose body streams more bytes than the envelope allows.
 *
 * Shaped around what the handler actually touches — `headers` and `body` — because the guard
 * now counts the stream rather than trusting `Content-Length`. `formData()` throws if it is
 * ever reached, which is what makes the test an assertion about *ordering* and not merely about
 * a status code: the point of the fix is that the body is abandoned before anything parses it.
 *
 * The stream yields in small chunks so the refusal happens part-way through, proving the count
 * is incremental rather than a check on an already-buffered whole.
 */
export const streamingRequest = ({
  totalBytes,
  contentLength,
  chunkBytes = 64 * 1024,
}: {
  totalBytes: number;
  contentLength?: string | null;
  chunkBytes?: number;
}): { request: Request; bytesPulled: () => number } => {
  let pulled = 0;

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - pulled);
      pulled += size;
      controller.enqueue(new Uint8Array(size));
    },
  });

  const headers = new Headers({ 'content-type': 'multipart/form-data; boundary=x' });
  if (contentLength !== null && contentLength !== undefined) {
    headers.set('content-length', contentLength);
  }

  const request = {
    headers,
    body,
    formData: async () => {
      throw new Error('formData() was reached — the body was parsed before it was bounded');
    },
  } as unknown as Request;

  return { request, bytesPulled: () => pulled };
};
