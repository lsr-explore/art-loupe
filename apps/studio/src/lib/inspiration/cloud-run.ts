import 'server-only';
import { getVercelOidcToken } from '@vercel/oidc';
import { env } from '@/env';

/** Workload identity federation: Vercel JWT -> STS access token -> Google ID token.
 * The Google token belongs in X-Serverless-Authorization; Authorization carries
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
  if (!env.GCP_WIF_AUDIENCE || !env.GCP_SERVICE_ACCOUNT)
    throw new Error('Cloud Run identity is not configured');
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
      body: JSON.stringify({ audience: url.origin, includeEmail: true }),
    },
  );
  if (!identity.ok) throw new Error('Cloud identity unavailable');
  const result = (await identity.json()) as { token?: string };
  if (!result.token) throw new Error('Cloud identity unavailable');
  return { 'X-Serverless-Authorization': `Bearer ${result.token}` };
};
