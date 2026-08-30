import 'server-only';

import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { getSessionOptions } from './options';
import { type AuthProvider, demoAuthProvider, type TokenRefresher } from './provider';
import type { Credentials, Role, Session, SessionData } from './types';

/**
 * Server-side auth helpers for React Server Components, Route Handlers, and
 * Server Actions. Backed by the Next.js cookie store (`next/headers`).
 *
 * For Edge Middleware use `@artloupe/auth/middleware` instead — that runtime hands
 * the session a request/response pair rather than the cookie store.
 */

/**
 * How far ahead of expiry an access token is refreshed.
 *
 * Without a margin, a token that passes the check can still expire in flight and the
 * downstream service answers 401 for a request that was valid when it left.
 */
const REFRESH_SKEW_SECONDS = 60;

const readSession = async () => {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
};

/** The current authenticated session, or `null` if signed out. */
export const getSession = async (): Promise<Session | null> => {
  const session = await readSession();
  return session.user ?? null;
};

export interface SignInResult {
  ok: boolean;
}

export interface SignInOptions {
  /**
   * Roles permitted on this surface. A principal outside the list is refused and **no
   * session is written**.
   *
   * Checked before persistence rather than by the route guard afterwards, so there is no
   * moment where a rejected user holds a valid cookie. It is also the difference between
   * "you may not view this page" and "you may not sign in here", and the second is the
   * true statement for a surface an artist has no business reaching.
   *
   * Omitted means any authenticated principal is accepted.
   */
  allowRoles?: readonly Role[];
}

/**
 * Validate credentials through the given provider and, on success, persist the
 * session cookie. Must run in a mutable cookie context (Server Action or Route
 * Handler). Defaults to the demo provider; the apps pass a Supabase-backed one.
 *
 * `allowRoles` restricts which principals may sign in at all — see `SignInOptions`.
 *
 * Any tokens the provider issued are sealed into the same encrypted cookie. They never
 * reach the browser, which only ever holds an opaque value — an XSS cannot read a
 * credential that was never sent to it.
 */
export const signIn = async (
  credentials: Credentials,
  provider: AuthProvider = demoAuthProvider,
  { allowRoles }: SignInOptions = {},
): Promise<SignInResult> => {
  const result = await provider.authenticate(credentials);

  if (!result) {
    return { ok: false };
  }

  if (allowRoles && !allowRoles.includes(result.user.role)) {
    // Reported to the caller exactly like a bad password. Telling an artist that their
    // credentials were correct but their role was wrong confirms a valid account to
    // anyone probing the operations login.
    return { ok: false };
  }

  const session = await readSession();
  session.user = result.user;
  session.tokens = result.tokens;
  await session.save();

  return { ok: true };
};

/** Clear the session cookie. */
export const signOut = async (): Promise<void> => {
  const session = await readSession();
  session.destroy();
};

/**
 * A usable Supabase access token for the current session, refreshing if it is spent.
 *
 * Reconciles the two clocks this system runs on: the sealed cookie's TTL and the access
 * token's own expiry. They can disagree — a cookie still valid on day three can wrap a
 * refresh token revoked on day one when the artist changed their password.
 *
 * When the token cannot be renewed, the session is **destroyed** rather than left in
 * place. A surviving seal over a dead token is the worst outcome available: the route
 * guard reports a signed-in user while every data call fails, so the artist sees a broken
 * app instead of a login form.
 *
 * Mutable cookie context only (Server Action or Route Handler) — it may write or clear the
 * cookie. Calling it from a Server Component throws.
 */
export const getAccessToken = async (refresher?: TokenRefresher): Promise<string | null> => {
  const session = await readSession();
  const tokens = session.tokens;

  if (!tokens) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (tokens.expiresAt - REFRESH_SKEW_SECONDS > nowSeconds) {
    return tokens.accessToken;
  }

  // No refresher supplied means nothing can renew this token, so the seal must not
  // outlive it.
  const refreshed = refresher ? await refresher.refresh(tokens.refreshToken) : null;

  if (!refreshed) {
    session.destroy();
    return null;
  }

  session.tokens = refreshed;
  await session.save();

  return refreshed.accessToken;
};

export class NotAuthenticatedError extends Error {
  constructor() {
    super('No valid session. The caller should redirect to the login page.');
    this.name = 'NotAuthenticatedError';
  }
}

/**
 * Call a backend service as the signed-in user.
 *
 * This is the one place the access token leaves the cookie, and it only ever travels
 * server-to-server: the browser is not party to this request and never sees the token.
 *
 * Throws `NotAuthenticatedError` when there is no usable token, so a caller cannot
 * accidentally issue an unauthenticated request that a service then rejects in a
 * harder-to-diagnose way.
 */
export const fetchWithSession = async (
  url: string | URL,
  init: RequestInit = {},
  refresher?: TokenRefresher,
): Promise<Response> => {
  const accessToken = await getAccessToken(refresher);

  if (!accessToken) {
    throw new NotAuthenticatedError();
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);

  return fetch(url, { ...init, headers });
};
