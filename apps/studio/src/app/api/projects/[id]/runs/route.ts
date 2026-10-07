/**
 * Start a run of one project (the walking skeleton's S2).
 *
 * Forwards to the agent's `POST /runs` with the artist's own token and answers 202 with the run
 * id. The run then continues as a background job, and the browser follows it on
 * `/api/runs/{id}/events`. Ownership is not decided here: the agent's recorder refuses a project
 * that is not this artist's, and that refusal comes back as the same 404 every other route uses.
 */
import { getAccessToken } from '@artloupe/auth/server';
import { NextResponse, type NextRequest } from 'next/server';

import { env } from '@/env';
import { agentUnavailable, notFound, unauthenticated } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { agentRequest } from '@/lib/runs/agent-request';
import type { StartRunResponse } from '@/lib/runs/run-contract';

/** RFC 4122 shape, matching the other project routes. Anything else is not an id we issued. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AGENT_TIMEOUT_MS = 15_000;

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return notFound();

  // No token means no session that could own a project.
  const accessToken = await getAccessToken();
  if (accessToken === null) return notFound();

  if (!env.ARTLOUPE_AGENT_URL) return agentUnavailable();

  let response: Response;
  try {
    response = await agentRequest({
      agentUrl: env.ARTLOUPE_AGENT_URL,
      accessToken,
      path: '/runs',
      method: 'POST',
      body: { project_id: id },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(AGENT_TIMEOUT_MS)]),
    });
  } catch (error) {
    logger.error({ err: error }, 'could not reach the agent to start a run');
    return agentUnavailable();
  }

  if (response.status === 404) return notFound();
  if (response.status === 401) return unauthenticated();
  if (response.status !== 202) {
    logger.error({ status: response.status }, 'the agent refused to start a run');
    return agentUnavailable();
  }

  const body: unknown = await response.json().catch(() => null);
  const runId = (body as { run_id?: unknown } | null)?.run_id;
  if (typeof runId !== 'string' || !UUID_PATTERN.test(runId)) {
    logger.error('the agent accepted a run but returned no usable run id');
    return agentUnavailable();
  }

  return NextResponse.json<StartRunResponse>({ runId }, { status: 202 });
};
