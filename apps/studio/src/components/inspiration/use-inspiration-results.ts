'use client';
import { type InspirationRequest, inspirationRequestSchema } from '@artloupe/schemas/inspiration';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchInspiration } from '@/lib/inspiration/search';

/** Server state for one committed search. The query key is the validated request, so
 * the same normalized search reuses its cached pages, and an invalid one never fetches.
 */
export const useInspirationResults = (committed: InspirationRequest) => {
  const valid = inspirationRequestSchema.safeParse(committed);
  const request = valid.success ? valid.data : committed;
  const search = useInfiniteQuery({
    queryKey: ['inspiration', request],
    enabled: valid.success,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchInspiration({ ...request, page: pageParam }, signal),
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
  });
  const items = search.data?.pages.flatMap((page) => page.items) ?? [];
  return { search, valid: valid.success, items };
};

export type InspirationResults = ReturnType<typeof useInspirationResults>;
