import { getAccessToken } from '@artloupe/auth/server';
import type { NextRequest } from 'next/server';

import { env } from '@/env';
import { agentUnavailable, notFound, unauthenticated } from '@/lib/api/responses';
import { agentRequest } from '@/lib/runs/agent-request';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOOLS = new Set([
  'grayscale',
  'value_map',
  'value_shapes',
  'outline',
  'perspective',
  'head_construction',
]);

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tool: string }> },
) => {
  const { id, tool } = await params;
  if (!UUID.test(id) || !TOOLS.has(tool)) return notFound();
  const token = await getAccessToken();
  if (token === null) return notFound();
  if (!env.ARTLOUPE_AGENT_URL) return agentUnavailable();
  try {
    const recipe = new URLSearchParams();
    for (const key of ['version', 'checksum']) {
      const value = request.nextUrl.searchParams.get(key);
      if (value !== null) recipe.set(key, value);
    }
    const response = await agentRequest({
      agentUrl: env.ARTLOUPE_AGENT_URL,
      accessToken: token,
      path: `/projects/${id}/artifacts/${tool}?${recipe}`,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
    });
    if (response.status === 404) return notFound();
    if (response.status === 401) return unauthenticated();
    if (!response.ok || response.headers.get('content-type') !== 'image/png')
      return agentUnavailable();
    return new Response(await response.arrayBuffer(), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `${request.nextUrl.searchParams.has('download') ? 'attachment' : 'inline'}; filename="${tool}.png"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return agentUnavailable();
  }
};
