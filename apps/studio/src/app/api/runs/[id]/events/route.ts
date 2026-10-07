/**
 * Follow one run's progress as Server-Sent Events.
 *
 * The browser's `EventSource` cannot send an `Authorization` header, and it does not need to:
 * it calls this same-origin route with the session cookie, and this route adds the artist's
 * token on the server, exactly as every other agent call does (ADR 0002). `Last-Event-ID` is
 * forwarded, so a reconnect resumes from the browser's cursor.
 *
 * Every event is validated before it is relayed (`relay-run-events.ts`). A 204 from the agent,
 * meaning the browser already holds the run's final event, is passed on as 204, which is what
 * tells an `EventSource` to stop reconnecting.
 */
import { getAccessToken } from '@artloupe/auth/server';
import type { NextRequest } from 'next/server';

import { env } from '@/env';
import { agentUnavailable, notFound, unauthenticated } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { agentRequest } from '@/lib/runs/agent-request';
import { relayRunEvents } from '@/lib/runs/relay-run-events';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Digits only, and short: the agent applies the same rule, this just keeps junk off the wire. */
const CURSOR_PATTERN = /^[0-9]{1,9}$/;

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return notFound();

  // No token means no session that could own a run.
  const accessToken = await getAccessToken();
  if (accessToken === null) return notFound();

  if (!env.ARTLOUPE_AGENT_URL) return agentUnavailable();

  const cursor = request.headers.get('last-event-id')?.trim();
  let response: Response;
  try {
    response = await agentRequest({
      agentUrl: env.ARTLOUPE_AGENT_URL,
      accessToken,
      path: `/runs/${id}/events`,
      headers: cursor && CURSOR_PATTERN.test(cursor) ? { 'Last-Event-ID': cursor } : {},
      // No timeout of its own: the agent bounds the stream's length. Aborting with the browser
      // closes the upstream connection when the tab goes away.
      signal: request.signal,
    });
  } catch (error) {
    logger.error({ err: error }, 'could not reach the agent to follow a run');
    return agentUnavailable();
  }

  if (response.status === 204) return new Response(null, { status: 204 });
  if (response.status === 404) return notFound();
  if (response.status === 401) return unauthenticated();
  if (response.status !== 200 || response.body === null) {
    logger.error({ status: response.status }, 'the agent refused to stream a run');
    return agentUnavailable();
  }

  return new Response(relayRunEvents(response.body, id), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
};
