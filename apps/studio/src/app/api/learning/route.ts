import { getAccessToken } from '@artloupe/auth/server';
import { learningRequestSchema, learningResponseSchema } from '@artloupe/schemas/learning';

import { env } from '@/env';
import { cloudRunHeaders } from '@/lib/inspiration/cloud-run';

export const maxDuration = 65;
const MAX_BYTES = 64 * 1024;

const readQuestion = async (request: Request): Promise<unknown> => {
  if (!request.body) throw new Error('Missing body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new Error('Body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
};

export const POST = async (request: Request) => {
  const token = await getAccessToken();
  if (!token) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const origin = request.headers.get('origin');
  if (origin !== new URL(request.url).origin)
    return Response.json({ error: 'invalid_origin' }, { status: 403 });
  let parsed;
  try {
    parsed = learningRequestSchema.safeParse(await readQuestion(request));
  } catch {
    return Response.json({ error: 'invalid_question' }, { status: 400 });
  }
  if (!parsed.success) return Response.json({ error: 'invalid_question' }, { status: 400 });
  if (!env.ARTLOUPE_AGENT_URL)
    return Response.json({ error: 'learning_unavailable' }, { status: 503 });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
  try {
    const identity = await cloudRunHeaders(env.ARTLOUPE_AGENT_URL, signal);
    const response = await fetch(new URL('/learning/ask', env.ARTLOUPE_AGENT_URL), {
      method: 'POST',
      signal,
      redirect: 'error',
      cache: 'no-store',
      headers: {
        ...identity,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(parsed.data),
    });
    if (!response.ok) {
      const status = [401, 403, 413, 429, 503, 504].includes(response.status)
        ? response.status
        : 502;
      const rawWait = Number(response.headers.get('Retry-After'));
      const wait = Number.isInteger(rawWait) && rawWait > 0 ? Math.min(rawWait, 300) : 60;
      return Response.json(
        {
          error:
            status === 401
              ? 'unauthenticated'
              : status === 429
                ? 'rate_limited'
                : 'learning_unavailable',
        },
        { status, headers: status === 429 ? { 'Retry-After': String(wait) } : {} },
      );
    }
    const result = learningResponseSchema.safeParse(await response.json());
    if (!result.success) throw new Error('Invalid learning response');
    return Response.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'learning_unavailable' }, { status: 503 });
  }
};
