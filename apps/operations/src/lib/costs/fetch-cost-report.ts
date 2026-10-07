import 'server-only';
import { getAccessToken } from '@artloupe/auth/server';
import { type CostReport, type CostWindow, costReportSchema } from '@artloupe/schemas/ops-cost';

import { env } from '@/env';

export type CostReportResult =
  | { status: 'ok'; report: CostReport }
  /** No usable operator token: the session has none, or it expired. */
  | { status: 'signed-out' }
  /** The agent refused this operator's role. */
  | { status: 'forbidden' }
  /** No agent is configured, or it or its database did not answer. */
  | { status: 'unavailable' };

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

/** Local plain HTTP is allowed outside production; anything else must be HTTPS. */
const agentOrigin = (): URL | null => {
  if (!env.ARTLOUPE_AGENT_URL) return null;
  const url = new URL(env.ARTLOUPE_AGENT_URL);
  const local = env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname);
  return url.protocol === 'https:' || (local && url.protocol === 'http:') ? url : null;
};

/**
 * Ask the agent service for the cost report, as the signed-in operator.
 *
 * The operator's own token is the only credential this app sends. The agent checks the role,
 * then reads the ledger through a role only it holds — this app never touches the database.
 */
export const fetchCostReport = async (costWindow: CostWindow): Promise<CostReportResult> => {
  const token = await readToken();
  if (!token) return { status: 'signed-out' };
  const origin = agentOrigin();
  if (!origin) return { status: 'unavailable' };

  try {
    const url = new URL('/ops/costs', origin);
    url.searchParams.set('window', costWindow);
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) return { status: 'signed-out' };
    if (response.status === 403) return { status: 'forbidden' };
    if (!response.ok) return { status: 'unavailable' };
    const parsed = costReportSchema.safeParse(await response.json());
    // A report for another window would label one window's spend as another's.
    if (!parsed.success || parsed.data.window !== costWindow) return { status: 'unavailable' };
    return { status: 'ok', report: parsed.data };
  } catch {
    return { status: 'unavailable' };
  }
};
