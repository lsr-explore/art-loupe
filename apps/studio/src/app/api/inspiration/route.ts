import { getAccessToken } from '@artloupe/auth/server';
import { inspirationRequestSchema, inspirationResponseSchema } from '@artloupe/schemas/inspiration';
import { env } from '@/env';
import { cloudRunHeaders } from '@/lib/inspiration/cloud-run';

export const GET = async (request: Request) => {
  const token = await getAccessToken();
  if (!token) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = inspirationRequestSchema.safeParse({
    ...raw,
    page: raw.page === undefined ? 1 : Number(raw.page),
    highlights: raw.highlights === 'true',
    date_begin: raw.date_begin ? Number(raw.date_begin) : null,
    date_end: raw.date_end ? Number(raw.date_end) : null,
  });
  if (
    !parsed.success ||
    (raw.highlights !== undefined && !['true', 'false'].includes(raw.highlights))
  )
    return Response.json({ error: 'invalid_search' }, { status: 400 });
  if (!env.ARTLOUPE_AGENT_URL)
    return Response.json({ error: 'search_unavailable' }, { status: 503 });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
  try {
    const headers = await cloudRunHeaders(env.ARTLOUPE_AGENT_URL, signal);
    const response = await fetch(new URL('/inspiration/search', env.ARTLOUPE_AGENT_URL), {
      method: 'POST',
      signal,
      cache: 'no-store',
      redirect: 'error',
      headers: { ...headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (!response.ok) {
      const status = [401, 403, 429, 503].includes(response.status) ? response.status : 502;
      return Response.json(
        { error: status === 401 ? 'unauthenticated' : 'search_unavailable' },
        { status, headers: status === 429 ? { 'Retry-After': '60' } : {} },
      );
    }
    const result = inspirationResponseSchema.safeParse(await response.json());
    if (
      !result.success ||
      result.data.page !== parsed.data.page ||
      result.data.items.some((item) => item.source !== parsed.data.source)
    )
      throw new Error('Invalid search response');
    return Response.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'search_unavailable' }, { status: 503 });
  }
};
