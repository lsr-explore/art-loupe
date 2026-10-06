// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const oidc = vi.hoisted(() => vi.fn());
const settings = vi.hoisted(() => ({
  NODE_ENV: 'production',
  GCP_WIF_AUDIENCE:
    '//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/vercel/providers/vercel',
  GCP_SERVICE_ACCOUNT: 'studio@example.iam.gserviceaccount.com',
}));
vi.mock('server-only', () => ({}));
vi.mock('@vercel/oidc', () => ({ getVercelOidcToken: oidc }));
vi.mock('@/env', () => ({ env: settings }));

// The identity cache is module state, so every test starts from a fresh module.
let cloudRunHeaders: typeof import('./cloud-run').cloudRunHeaders;
beforeEach(async () => {
  vi.resetModules();
  ({ cloudRunHeaders } = await import('./cloud-run'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const idToken = (expiresInSeconds: number) =>
  [
    'header',
    Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString(
      'base64url',
    ),
    'signature',
  ].join('.');
const exchanges = (token: string) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) =>
      String(input).startsWith('https://sts.')
        ? Response.json({ access_token: 'access' })
        : Response.json({ token }),
    );
// @trace flow=inspiration.search category=security
describe('Cloud Run federation', () => {
  it('exchanges a request-scoped Vercel JWT and requests the backend audience', async () => {
    oidc.mockResolvedValue('vercel-jwt');
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ access_token: 'access' }))
      .mockResolvedValueOnce(Response.json({ token: 'google-id' }));
    expect(await cloudRunHeaders('https://agent.run.app', AbortSignal.timeout(1000))).toEqual({
      'X-Serverless-Authorization': 'Bearer google-id',
    });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      subjectToken: 'vercel-jwt',
    });
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toMatchObject({
      audience: 'https://agent.run.app',
    });
  });
  it('refuses unapproved production endpoints before requesting tokens', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(
      cloudRunHeaders('http://localhost:8080', AbortSignal.timeout(1000)),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not return an identity header when the exchange fails', async () => {
    oidc.mockResolvedValue('vercel-jwt');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      cloudRunHeaders('https://agent.run.app', AbortSignal.timeout(1000)),
    ).rejects.toThrow('Cloud identity unavailable');
  });
  // @trace category=performance
  it('reuses one ID token across requests until shortly before it expires', async () => {
    vi.useFakeTimers();
    oidc.mockResolvedValue('vercel-jwt');
    const fetch = exchanges(idToken(3600));
    const signal = AbortSignal.timeout(1000);
    await Promise.all([
      cloudRunHeaders('https://agent.run.app', signal),
      cloudRunHeaders('https://agent.run.app', signal),
    ]);
    await cloudRunHeaders('https://agent.run.app', signal);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(56 * 60 * 1000);
    await cloudRunHeaders('https://agent.run.app', signal);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('does not cache a failed exchange', async () => {
    oidc.mockResolvedValue('vercel-jwt');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(
      cloudRunHeaders('https://agent.run.app', AbortSignal.timeout(1000)),
    ).rejects.toThrow();
    const token = idToken(3600);
    exchanges(token);
    expect(await cloudRunHeaders('https://agent.run.app', AbortSignal.timeout(1000))).toEqual({
      'X-Serverless-Authorization': `Bearer ${token}`,
    });
  });
});
