/**
 * Reading the `sub` claim out of a Supabase access token.
 *
 * ## Why this reads a token without verifying it
 *
 * That sentence should stop a reviewer, so here is the argument in full.
 *
 * The token this parses did not arrive from a caller. It came out of our own iron-session
 * cookie, sealed with `AUTH_SESSION_PASSWORD`, having been put there by `signIn` after
 * Supabase issued it. A caller who could forge the contents of that cookie already holds the
 * session secret, at which point the signature on the token inside it is not what is standing
 * between them and the data.
 *
 * More to the point, **nothing trusts the answer**. The one caller is the upload path, which
 * needs the artist's user id to build a storage object key — and the storage INSERT policy
 * independently checks `(storage.foldername(name))[1] = auth.uid()::text` against the token as
 * Supabase itself verifies it. So a wrong `sub` here produces a *refused write*, not a
 * crossed boundary. The claim is a hint for constructing a key, and Postgres is what decides.
 *
 * The alternative — verifying the signature in the Next.js process — would mean fetching and
 * caching Supabase's JWKS in three apps to re-derive a value we could equally have stored at
 * sign-in, and would still not be the thing that authorizes anything.
 *
 * `python/libs/auth` does verify, and should: it receives tokens forwarded across a process
 * boundary from a caller it cannot vouch for. Different provenance, different rule.
 */

/**
 * The Supabase user id (`sub`) carried by an access token, or `null`.
 *
 * `null` rather than a throw for every failure — malformed, truncated, missing the claim, or
 * carrying a `sub` that is not a UUID. The caller's next move is the same in all four cases,
 * and a token that cannot be read is an ordinary "no usable session" answer rather than a
 * programming error.
 */
export const subjectFromAccessToken = (accessToken: string): string | null => {
  const segments = accessToken.split('.');
  if (segments.length !== 3) {
    return null;
  }

  const payload = decodePayload(segments[1]);
  if (payload === null) {
    return null;
  }

  const subject = payload.sub;
  if (typeof subject !== 'string' || !UUID_PATTERN.test(subject)) {
    return null;
  }

  // Lowercased because the value is about to become the leading segment of a storage object
  // key, and the storage policy compares it to `auth.uid()::text`, which Postgres renders in
  // lowercase. An uppercase UUID here would build a key its own owner could not read.
  return subject.toLowerCase();
};

/** RFC 4122 shape, any version — matching `buildReferenceImageKey` in the studio app. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Base64url-decode one JWT segment into an object.
 *
 * Hand-rolled rather than reached for from a library: this is the only JWT handling in the
 * package, and a dependency that can *verify* tokens sitting in the tree would invite exactly
 * the misuse the module docblock argues against.
 */
const decodePayload = (segment: string): Record<string, unknown> | null => {
  try {
    // Base64url → base64, then pad. `atob` rejects the URL-safe alphabet and unpadded input,
    // and a JWT segment is always both.
    const base64 = segment.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

    // `atob` yields one char per byte, so multi-byte UTF-8 has to be reassembled rather than
    // read directly — a `sub` is ASCII, but a claim alongside it need not be, and a throw
    // half way through decoding would lose the whole token for no reason.
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};
