import { createClient } from '@supabase/supabase-js';
import type { AuthProvider, TokenRefresher } from './provider';
import type { AuthResult, Role, Tokens } from './types';

/** Connection details for the Supabase Auth (GoTrue) endpoint. */
export interface SupabaseAuthConfig {
  /** Supabase project URL (e.g. `http://127.0.0.1:54321` locally). */
  url: string;
  /** Public anon key — sufficient for password sign-in; never the service-role key. */
  anonKey: string;
}

/** Key under Supabase `app_metadata` holding the Art Loupe role. */
const ROLE_METADATA_KEY = 'artloupe_role';

const KNOWN_ROLES: readonly Role[] = ['artist', 'operator', 'superuser'];

/**
 * Resolve the Art Loupe role from Supabase `app_metadata`.
 *
 * `app_metadata` is writable only with the service-role key, so its claims are
 * trustworthy. `user_metadata` is writable by the user themselves and is never read —
 * honouring a role there would be self-service privilege escalation.
 *
 * Anything unrecognised resolves to `artist`, the least-privileged role, so a typo in an
 * operator's metadata denies access rather than granting something unintended.
 */
const resolveRole = (appMetadata: Record<string, unknown> | undefined): Role => {
  const claimed = appMetadata?.[ROLE_METADATA_KEY];
  return KNOWN_ROLES.find((role) => role === claimed) ?? 'artist';
};

interface SupabaseSessionLike {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
}

/**
 * Normalise a Supabase session into our token shape.
 *
 * `expires_at` is absolute and is what we want; `expires_in` is the relative fallback for
 * the rare response that omits it. An absent expiry resolves to "already expired" rather
 * than "never expires", so an unreadable response fails closed into a refresh.
 */
const toTokens = (session: SupabaseSessionLike): Tokens => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt =
    session.expires_at ??
    (session.expires_in === undefined ? nowSeconds : nowSeconds + session.expires_in);

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt,
  };
};

/**
 * Supabase-backed artist auth.
 *
 * Validates email + password against Supabase Auth (GoTrue). The email travels in the
 * `username` credential slot, so the shared `AuthProvider` seam, session shape, and guard
 * are unchanged — only the provider passed to `signIn` differs from the demo one.
 *
 * Returns Supabase's own tokens alongside the principal. Nothing in Art Loupe ever mints a
 * token: relaying Supabase-signed JWTs is what lets Postgres RLS resolve `auth.uid()` for
 * the real user on every downstream query. See ADR 0002.
 *
 * A stateless client is created per call: `authenticate` runs inside a server action and we
 * keep our own iron-session cookie, so the SDK must not persist or refresh its own session
 * (`persistSession: false`, `autoRefreshToken: false`).
 */
export const createSupabaseAuthProvider = ({ url, anonKey }: SupabaseAuthConfig): AuthProvider => ({
  authenticate: async ({ username, password }): Promise<AuthResult | null> => {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: username,
      password,
    });

    // Invalid credentials, an unconfirmed account, or any GoTrue error → no session.
    if (error || !data.user || !data.session) {
      return null;
    }

    return {
      user: {
        username: data.user.email ?? username,
        role: resolveRole(data.user.app_metadata),
      },
      tokens: toTokens(data.session),
    };
  },
});

/**
 * Refresh against Supabase directly.
 *
 * Separate from `AuthProvider` because refreshing is not authenticating: it takes no
 * credentials, and `demoAuthProvider` has nothing to refresh. Keeping the seams apart lets
 * `apps/operations` stay on the demo provider without acquiring a meaningless refresher.
 */
export const createSupabaseTokenRefresher = ({
  url,
  anonKey,
}: SupabaseAuthConfig): TokenRefresher => ({
  refresh: async (refreshToken) => {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data.session) {
      return null;
    }

    return toTokens(data.session);
  },
});
