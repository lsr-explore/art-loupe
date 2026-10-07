import 'server-only';
/**
 * One request to the agent service, as the signed-in artist.
 *
 * Per ADR 0002 the browser never reaches the agent: a route handler forwards the artist's
 * Supabase access token, and the agent verifies it. On Cloud Run the service's own identity
 * token travels alongside in `cloudRunHeaders`, exactly as the inspiration route sends it.
 *
 * `redirect: 'error'` because a redirect from the agent would carry the bearer token to wherever
 * it pointed.
 */
import { cloudRunHeaders } from '@/lib/inspiration/cloud-run';

export interface AgentRequest {
  agentUrl: string;
  accessToken: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}

export const agentRequest = async ({
  agentUrl,
  accessToken,
  path,
  method = 'GET',
  body,
  headers = {},
  signal,
  fetchImpl = fetch,
}: AgentRequest): Promise<Response> => {
  const identity = await cloudRunHeaders(agentUrl, signal);
  return fetchImpl(new URL(path, agentUrl), {
    method,
    signal,
    cache: 'no-store',
    redirect: 'error',
    headers: {
      ...identity,
      ...headers,
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
};
