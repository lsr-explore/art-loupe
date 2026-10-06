import 'server-only';
import { getVercelOidcToken } from '@vercel/oidc';
import { env } from '@/env';

// Google ID tokens live an hour. Refresh a little early so one never expires in flight.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MINT_TIMEOUT_MS = 10000;

interface CachedIdentity {
  origin: string;
  refreshAt: number;
  token: Promise<string>;
}

/** One service identity per server instance, shared by every artist's request. It
 * carries no user data: the artist's own token travels separately in Authorization.
 * The in-flight promise is cached too, so concurrent requests share one exchange.
 */
let cached: CachedIdentity | undefined;

const expiresAt = (jwt: string): number => {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : Date.now();
  } catch {
    // An unreadable expiry is treated as already expired: use once, mint again next time.
    return Date.now();
  }
};

/** Workload identity federation: Vercel JWT -> STS access token -> Google ID token. */
const mintIdToken = async (audience: string): Promise<string> => {
  if (!env.GCP_WIF_AUDIENCE || !env.GCP_SERVICE_ACCOUNT)
    throw new Error('Cloud Run identity is not configured');
  // Not the artist's request signal: one artist cancelling must not fail a shared exchange.
  const signal = AbortSignal.timeout(MINT_TIMEOUT_MS);
  const exchange = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    signal,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audience: env.GCP_WIF_AUDIENCE,
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      subjectToken: await getVercelOidcToken(),
    }),
  });
  if (!exchange.ok) throw new Error('Cloud identity unavailable');
  const token = (await exchange.json()) as { access_token?: string };
  if (!token.access_token) throw new Error('Cloud identity unavailable');
  const identity = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(env.GCP_SERVICE_ACCOUNT)}:generateIdToken`,
    {
      method: 'POST',
      signal,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audience, includeEmail: true }),
    },
  );
  if (!identity.ok) throw new Error('Cloud identity unavailable');
  const result = (await identity.json()) as { token?: string };
  if (!result.token) throw new Error('Cloud identity unavailable');
  return result.token;
};

/** The Google token belongs in X-Serverless-Authorization; Authorization carries
 * the artist's Supabase token and is verified by FastAPI independently.
 */
export const cloudRunHeaders = async (
  origin: string,
  signal: AbortSignal,
): Promise<Record<string, string>> => {
  const url = new URL(origin);
  if (
    env.NODE_ENV !== 'production' &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname)
  )
    return {};
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.run.app') ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('Invalid backend origin');
  if (!cached || cached.origin !== url.origin || Date.now() >= cached.refreshAt) {
    const entry: CachedIdentity = {
      origin: url.origin,
      refreshAt: Number.POSITIVE_INFINITY,
      token: mintIdToken(url.origin),
    };
    cached = entry;
    entry.token.then(
      (token) => {
        entry.refreshAt = expiresAt(token) - REFRESH_MARGIN_MS;
      },
      () => {
        // A failed exchange is never cached; the next request tries again.
        if (cached === entry) cached = undefined;
      },
    );
  }
  const token = await cached.token;
  signal.throwIfAborted();
  return { 'X-Serverless-Authorization': `Bearer ${token}` };
};
