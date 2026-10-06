import type { InspirationImage } from '@artloupe/schemas/inspiration';
export type ResultSort = 'provider' | 'title' | 'creator' | 'oldest' | 'newest';

/** Derived view state never mutates or replaces React Query's provider data. */
export const visibleResults = (
  items: InspirationImage[],
  filter: string,
  sort: ResultSort,
  locale = 'en',
) => {
  const needle = filter.trim().toLocaleLowerCase(locale);
  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  const visible = unique.filter((item) =>
    `${item.title} ${item.creator ?? ''}`.toLocaleLowerCase(locale).includes(needle),
  );
  if (sort === 'provider') return visible;
  return visible.toSorted((left, right) => {
    if (sort === 'title' || sort === 'creator')
      return (left[sort] ?? '').localeCompare(right[sort] ?? '', locale);
    // Unknown dates always sort last, including in descending order.
    if (left.year === null) return right.year === null ? 0 : 1;
    if (right.year === null) return -1;
    return sort === 'oldest' ? left.year - right.year : right.year - left.year;
  });
};
