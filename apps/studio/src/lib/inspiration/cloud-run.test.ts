// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { cloudRunHeaders } from './cloud-run';

afterEach(() => vi.restoreAllMocks());
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
});
