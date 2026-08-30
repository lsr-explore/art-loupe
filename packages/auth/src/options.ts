import type { SessionOptions } from 'iron-session';

/** Cookie name for the encrypted demo session. */
export const SESSION_COOKIE_NAME = 'artloupe_session';

const MIN_PASSWORD_LENGTH = 32;

/**
 * Session lifetime, in seconds. Eight hours — a working session, not a fortnight.
 *
 * iron-session's own default is 14 days, which is far too long for a surface holding
 * Supabase tokens. Each app can tighten this via `AUTH_SESSION_TTL`; `apps/operations`
 * should, being the higher-privilege surface. See ADR 0002.
 */
const DEFAULT_TTL_SECONDS = 60 * 60 * 8;

/**
 * Resolve the session TTL from the environment.
 *
 * Rejects zero explicitly: iron-session reads `ttl = 0` as "never expires", so a stray
 * `AUTH_SESSION_TTL=0` would silently produce an immortal session rather than an obviously
 * broken one.
 */
const readTtlSeconds = (): number => {
  const configured = process.env.AUTH_SESSION_TTL;

  if (!configured) {
    return DEFAULT_TTL_SECONDS;
  }

  const parsed = Number.parseInt(configured, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('AUTH_SESSION_TTL must be a positive whole number of seconds.');
  }

  return parsed;
};

/**
 * iron-session configuration, resolved at call time from the environment.
 *
 * Reads `AUTH_SESSION_PASSWORD` lazily (not at module load) so importing this
 * package never throws during a build step where the secret is absent. Apps
 * also declare the var in their `env.ts` for build-time validation and typing.
 */
export const getSessionOptions = (): SessionOptions => {
  const password = process.env.AUTH_SESSION_PASSWORD;

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `AUTH_SESSION_PASSWORD must be set and at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  // A `Secure` cookie is only sent over HTTPS. In production that's what we want,
  // but a prod build served over plain HTTP on localhost (e.g. Playwright's
  // webServer) must not mark it Secure or strict engines like WebKit drop it —
  // mirror the `DISABLE_HTTPS_UPGRADE` opt-out used for the HTTPS headers.
  const secure =
    process.env.NODE_ENV === 'production' && process.env.DISABLE_HTTPS_UPGRADE !== 'true';

  return {
    password,
    cookieName: SESSION_COOKIE_NAME,
    // Sealed into the encrypted payload, so the server decides when a session is over.
    // A client editing cookie attributes cannot extend it; iron-session also derives
    // `cookieOptions.maxAge` from this so the browser drops it at roughly the same time.
    ttl: readTtlSeconds(),
    cookieOptions: {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
    },
  };
};
