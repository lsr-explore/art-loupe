import type { AuthResult, Credentials, Tokens } from './types';

/**
 * The swappable authentication seam.
 *
 * `createSupabaseAuthProvider` provides a Supabase-backed implementation of this same
 * interface; the login flow, session shape, and guard do not change — only the provider
 * passed to `signIn` does.
 */
export interface AuthProvider {
  /** Validate credentials, returning the resolved principal or `null` if invalid. */
  authenticate(credentials: Credentials): Promise<AuthResult | null>;
}

/**
 * Exchanges a spent access token for a fresh pair.
 *
 * A separate seam from `AuthProvider` because refreshing is not authenticating: it takes no
 * credentials, and a provider without tokens has nothing to refresh. Keeping them apart
 * lets `apps/operations` stay on the demo provider without acquiring a meaningless
 * refresher.
 */
export interface TokenRefresher {
  /** Fresh tokens, or `null` when the refresh token is spent, revoked, or invalid. */
  refresh(refreshToken: string): Promise<Tokens | null>;
}

/**
 * Constant-time string comparison.
 *
 * `===` on strings short-circuits at the first differing byte, so response timing leaks
 * how much of a secret a guess got right. Hashing first gives two fixed-length digests to
 * compare, which sidesteps `timingSafeEqual`'s equal-length requirement without revealing
 * the secret's length either.
 *
 * Web Crypto rather than `node:crypto` on purpose: this module is exported from the
 * runtime-agnostic entry point, and `node:crypto` would break an Edge bundle.
 */
const constantTimeEquals = async (left: string, right: string): Promise<boolean> => {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);

  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
};

/**
 * Demo provider — validates against a single super-user credential from the environment
 * (`DEMO_AUTH_USERNAME` / `DEMO_AUTH_PASSWORD`).
 *
 * A shared credential with total privilege, so it is a stopgap for `apps/operations` and
 * for hermetic e2e runs only. It issues no tokens, which means a demo session cannot reach
 * the Python services at all — they require a Supabase-signed token. See ADR 0002 for the
 * path to real per-person operator accounts.
 */
export const demoAuthProvider: AuthProvider = {
  authenticate: async ({ username, password }) => {
    const expectedUsername = process.env.DEMO_AUTH_USERNAME;
    const expectedPassword = process.env.DEMO_AUTH_PASSWORD;

    if (!expectedUsername || !expectedPassword) {
      throw new Error('DEMO_AUTH_USERNAME and DEMO_AUTH_PASSWORD must be set.');
    }

    // Both comparisons always run: bailing early on a wrong username would make the
    // username check measurably faster than the password check.
    const usernameMatches = await constantTimeEquals(username, expectedUsername);
    const passwordMatches = await constantTimeEquals(password, expectedPassword);

    if (!usernameMatches || !passwordMatches) {
      return null;
    }

    return { user: { username, role: 'superuser' } };
  },
};
