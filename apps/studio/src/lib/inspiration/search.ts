import { type InspirationRequest, inspirationResponseSchema } from '@artloupe/schemas/inspiration';
export const INSPIRATION_ENDPOINT = '/api/inspiration';
export class SearchError extends Error {
  constructor(public status: number) {
    super('Image search failed');
  }
}
export const fetchInspiration = async (request: InspirationRequest, signal: AbortSignal) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request))
    if (value !== null && value !== '') params.set(key, String(value));
  const response = await fetch(`${INSPIRATION_ENDPOINT}?${params}`, {
    signal,
    credentials: 'same-origin',
  });
  if (!response.ok) throw new SearchError(response.status);
  const parsed = inspirationResponseSchema.safeParse(await response.json());
  if (
    !parsed.success ||
    parsed.data.page !== request.page ||
    parsed.data.items.some((item) => item.source !== request.source)
  )
    throw new SearchError(502);
  return parsed.data;
};
