/**
 * The role carried on a session.
 *
 * Resolved from Supabase `app_metadata.artloupe_role`, which is writable only with the
 * service-role key — a user cannot promote themselves. `user_metadata` is user-writable
 * and is deliberately never consulted.
 */
export type Role = 'artist' | 'operator' | 'superuser';

/** The authenticated principal persisted in the session cookie. */
export interface Session {
  username: string;
  role: Role;
}

/**
 * Supabase's own tokens, held server-side only.
 *
 * Never exposed to the browser: they live inside the encrypted iron-session payload, and
 * the client only ever sees an opaque cookie. That is what keeps an XSS or a compromised
 * dependency from walking away with a usable credential.
 */
export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry of the access token, in unix seconds. */
  expiresAt: number;
}

/**
 * What a provider returns on a successful authentication.
 *
 * `tokens` is optional because not every provider issues them — `demoAuthProvider`
 * authenticates without any Supabase involvement and therefore has none to give.
 */
export interface AuthResult {
  user: Session;
  tokens?: Tokens;
}

/** Shape stored inside the encrypted session cookie. */
export interface SessionData {
  user?: Session;
  tokens?: Tokens;
}

/** Credentials submitted at the login form. */
export interface Credentials {
  username: string;
  password: string;
}
