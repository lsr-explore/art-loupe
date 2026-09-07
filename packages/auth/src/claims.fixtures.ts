/**
 * Tokens for the `sub`-claim reader.
 *
 * These are **structurally** real JWTs — three base64url segments, a JSON payload — and
 * cryptographically meaningless: the signature segment is a literal. That is the correct
 * shape for this fixture rather than a shortcut, because `subjectFromAccessToken` deliberately
 * does not verify signatures (see the docblock in `claims.ts`). A fixture carrying real
 * signatures would imply a guarantee the module does not make, and the first reader to notice
 * would reasonably assume verification had been dropped by accident.
 */

/** A real lowercase RFC 4122 UUID, using hex letters so a case test is not vacuous. */
export const SUBJECT = '7f3d9a2e-4b1c-4e8f-9a6d-2c5b8e1f4a7d';

/** Base64url with no padding, which is what a JWT segment actually looks like. */
const encodeSegment = (value: unknown): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

/** Assemble a token around an arbitrary payload. The signature is never read. */
export const tokenWithPayload = (payload: unknown): string =>
  [encodeSegment({ alg: 'HS256', typ: 'JWT' }), encodeSegment(payload), 'not-a-signature'].join(
    '.',
  );

/**
 * What Supabase actually issues, trimmed to the claims that matter here.
 *
 * `role` and `email` are kept because a payload of exactly one key would not exercise the
 * "find the right claim among others" path at all.
 */
export const VALID_TOKEN = tokenWithPayload({
  sub: SUBJECT,
  role: 'authenticated',
  email: 'artist@example.invalid',
  exp: 4102444800,
});

/**
 * The same subject in uppercase.
 *
 * Not a hypothetical: `auth.uid()::text` renders lowercase, the storage policy compares the
 * key's leading segment to it, and an uppercase segment would build a key its own owner cannot
 * read. `parseReferenceImageKey` in the studio app refuses such a key outright, so this is the
 * case that keeps the two ends agreeing.
 */
export const UPPERCASE_SUBJECT_TOKEN = tokenWithPayload({ sub: SUBJECT.toUpperCase() });

/** A payload carrying multi-byte UTF-8 beside the subject, which `atob` alone would mangle. */
export const UNICODE_CLAIMS_TOKEN = tokenWithPayload({
  sub: SUBJECT,
  name: 'Ana Muñoz — Estudio “Luz”',
});

/** Every way a token can fail to yield a subject. Each must answer `null`, never throw. */
export const UNREADABLE_TOKENS: Record<string, string> = {
  empty: '',
  'not a jwt at all': 'nonsense',
  'two segments': 'header.payload',
  'four segments': 'a.b.c.d',
  'payload that is not base64url': 'header.!!!!.signature',
  'payload that is not JSON': `header.${btoa('not json').replaceAll('=', '')}.signature`,
  'payload that is a JSON array': tokenWithPayload([SUBJECT]),
  'payload that is a JSON string': tokenWithPayload('just a string'),
  'payload with no sub': tokenWithPayload({ role: 'authenticated' }),
  'sub that is not a string': tokenWithPayload({ sub: 12345 }),
  'sub that is null': tokenWithPayload({ sub: null }),
  'sub that is not a UUID': tokenWithPayload({ sub: 'artist@example.invalid' }),
  // A traversal attempt in the one claim that becomes a storage path segment.
  'sub carrying a path segment': tokenWithPayload({ sub: '../../etc/passwd' }),
};
