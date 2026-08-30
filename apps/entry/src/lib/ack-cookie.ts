import { env } from '@/env';

/**
 * Re-exported so the writer side of the gate reads from one module.
 *
 * The name itself is owned by `@artloupe/auth/ack`, alongside the readers in the three
 * apps' middleware — one declaration, so renaming the cookie cannot half-land. That
 * subpath pulls in nothing but a `NextRequest` type: no iron-session, no Supabase,
 * and no session is ever read here. The entry point is still never authenticated;
 * it merely shares the constant with the surfaces that are.
 */
export { ACK_COOKIE_NAME } from '@artloupe/auth/ack';

/**
 * The subset of `Set-Cookie` attributes this module sets.
 *
 * Declared locally rather than imported: the `cookie` package's `SerializeOptions`
 * is a transitive dependency we do not declare, and Next's own `ResponseCookie`
 * lives behind a `next/dist/server/...` path that is not a public entry point.
 * Structural typing means this still checks against `cookies().set()`.
 */
interface AckCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  domain: string | undefined;
}

/** The only value we ever write; presence is what matters, not the contents. */
export const ACK_COOKIE_VALUE = '1';

/**
 * Options for `Set-Cookie`.
 *
 * Session-scoped by omission: no `maxAge` and no `expires` means the browser drops
 * it on close, which is what the shell spec settled. Do not add an expiry to "improve" the
 * demo — a returning visitor re-acknowledging is the intended behaviour.
 */
export const ackCookieOptions = (): AckCookieOptions => ({
  httpOnly: true,
  // Mirrors `@artloupe/auth`'s opt-out: a production build served over plain HTTP
  // (Playwright's webServer) must not mark the cookie Secure, or strict engines
  // drop it and the gate appears broken with no error anywhere.
  secure: env.NODE_ENV === 'production' && process.env.DISABLE_HTTPS_UPGRADE !== 'true',
  // Lax, not Strict: the apps redirect *here* and we redirect back, and Strict
  // withholds the cookie on a cross-site navigation — the arriving request would
  // look unacknowledged and bounce the user straight back into the gate.
  sameSite: 'lax',
  path: '/',
  // Undefined in development, where it must be: see the note on ACK_COOKIE_DOMAIN.
  domain: env.ACK_COOKIE_DOMAIN,
});
