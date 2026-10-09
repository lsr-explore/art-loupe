import 'server-only';
import { getAccessToken } from '@artloupe/auth/server';
import type { ZodType } from 'zod/v4';

import { env } from '@/env';

/** Why an operations read produced no data. Each state renders its own explanation. */
export type OpsFailure =
  /** No usable operator token: the session has none, or it expired. */
  | 'signed-out'
  /** The agent refused this operator's role. */
  | 'forbidden'
  /** The agent has no such record. */
  | 'not-found'
  /** No agent is configured, or it or its database did not answer. */
  | 'unavailable';

export type OpsResult<Data> = { status: 'ok'; data: Data } | { status: OpsFailure };

const TIMEOUT_MS = 10_000;

const readToken = async (): Promise<string | null> => {
  try {
    return await getAccessToken();
  } catch {
    // An expired token makes `getAccessToken` clear the session cookie, which a Server
    // Component may not do. Either way the operator has to sign in again.
    return null;
  }
};

/**
 * Plain HTTP is allowed outside production, to any host: the agent is `127.0.0.1` on the
 * host and `agent` inside the Compose network. Production must be HTTPS.
 */
const agentOrigin = (): URL | null => {
  if (!env.ARTLOUPE_AGENT_URL) return null;
  const url = new URL(env.ARTLOUPE_AGENT_URL);
  const development = env.NODE_ENV !== 'production' && url.protocol === 'http:';
  return url.protocol === 'https:' || development ? url : null;
};

const FAILURES: Record<number, OpsFailure> = {
  401: 'signed-out',
  403: 'forbidden',
  404: 'not-found',
};

/**
 * Read one operations resource from the agent service, as the signed-in operator.
 *
 * The operator's own token is the only credential this app sends. The agent checks the role,
 * then reads through a database role only it holds — this app never touches the database.
 * `matches` rejects a well-formed answer to a different question, such as another window.
 */
export const readFromAgent = async <Data>(
  path: string,
  schema: ZodType<Data>,
  matches: (data: Data) => boolean = () => true,
): Promise<OpsResult<Data>> => {
  const token = await readToken();
  if (!token) return { status: 'signed-out' };
  const origin = agentOrigin();
  if (!origin) return { status: 'unavailable' };

  try {
    const response = await fetch(new URL(path, origin), {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return { status: FAILURES[response.status] ?? 'unavailable' };
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success || !matches(parsed.data)) return { status: 'unavailable' };
    return { status: 'ok', data: parsed.data };
  } catch {
    return { status: 'unavailable' };
  }
};
