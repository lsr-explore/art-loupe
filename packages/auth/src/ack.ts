import type { NextRequest } from 'next/server';

/**
 * The synthetic-data acknowledgement gate.
 *
 * **This is not authentication.** It lives in this package because all three app
 * surfaces already import `@artloupe/auth/middleware`, so one import line covers both
 * gates — but the two are deliberately opposite in scope, and conflating them is the
 * mistake this comment exists to prevent:
 *
 * - `artloupe_session` is **host-only**, so an operator session cannot be replayed on
 *   the studio app. The apps stay isolated.
 * - `artloupe_ack` is **domain-scoped** (`Domain=.artloupestudio.com`), so acknowledging
 *   once at the apex covers all three subdomains.
 *
 * Never widen the session cookie to match, and never narrow this one: the first
 * leaks a session across surfaces, the second makes the user acknowledge three times.
 *
 * The two cannot be collapsed into one signal even setting scope aside: the
 * acknowledgement has to be readable *before* login, and a session only exists
 * *after*. Gating on the session would bounce every first-time visitor to the entry
 * point, then bounce them again on return — still unauthenticated — forever.
 *
 * This module is the single declaration of the name. The three apps read it in
 * middleware; the entry point writes the cookie and re-exports the name from
 * `apps/entry/src/lib/ack-cookie.ts`. Entry importing this subpath does not make it
 * an authenticated surface — the subpath pulls in nothing beyond a
 * `NextRequest` type, and entry never reads a session.
 */
export const ACK_COOKIE_NAME = 'artloupe_ack';

/**
 * Whether this request carries the acknowledgement.
 *
 * Presence is the whole signal — the value is never read. It is a demo disclaimer,
 * not a consent record, so there is nothing to verify and nothing worth signing.
 */
export const hasAcknowledged = (request: NextRequest): boolean =>
  request.cookies.get(ACK_COOKIE_NAME) !== undefined;

interface AcknowledgementRedirectArgs {
  request: NextRequest;
  /** Origin of the entry point — each app's `NEXT_PUBLIC_ENTRY_URL`. */
  entryOrigin: string;
  /**
   * This app's *public* origin (`NEXT_PUBLIC_APP_URL`). Falls back to the request's
   * own origin, which is right in development and wrong behind a proxy that
   * terminates TLS: there `request.nextUrl.origin` is the internal address, and a
   * `next=` built from it would send the user somewhere unreachable.
   */
  appOrigin?: string;
}

/**
 * Where to send a visitor who has not acknowledged: the entry point, carrying
 * `?next=` so ticking the box resumes the deep link instead of dead-ending at the
 * panel grid.
 *
 * The value is a full absolute URL, not a path — entry validates it against an
 * allowlist of the three app origins, and a bare path could not identify a surface.
 * `URL`'s setter percent-encodes it, so no manual escaping.
 */
export const acknowledgementRedirectUrl = ({
  request,
  entryOrigin,
  appOrigin,
}: AcknowledgementRedirectArgs): URL => {
  const resumeTo = new URL(
    request.nextUrl.pathname + request.nextUrl.search,
    appOrigin ?? request.nextUrl.origin,
  );

  const gate = new URL('/', entryOrigin);
  gate.searchParams.set('next', resumeTo.toString());
  return gate;
};
