import type { InspirationImage } from '@artloupe/schemas/inspiration';
import { describe, expect, it } from 'vitest';
import { visibleResults } from './results';

const image = (id: string, title: string, year: number | null): InspirationImage => ({
  id,
  title,
  year,
  creator: 'Van Gogh',
  source: 'met',
  medium: null,
  date: null,
  alt: title,
  image_url: 'https://images.metmuseum.org/a.jpg',
  source_url: 'https://www.metmuseum.org/a',
});
const items = [image('1', 'Zebra', 1900), image('2', 'Apple', 1800), image('3', 'Untitled', null)];
// @trace flow=inspiration.search category=data
describe('inspiration.search: derived result controls', () => {
  it('deduplicates loaded pages and preserves provider order', () =>
    expect(visibleResults([...items, items[0]], '', 'provider')).toEqual(items));
  it('sorts without mutating the query cache and keeps unknown years last', () => {
    expect(visibleResults(items, '', 'newest').map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(visibleResults(items, '', 'oldest').map((item) => item.id)).toEqual(['2', '1', '3']);
    expect(items.map((item) => item.id)).toEqual(['1', '2', '3']);
  });
  it('filters title or creator case-insensitively', () => {
    expect(visibleResults(items, 'APPLE', 'title').map((item) => item.id)).toEqual(['2']);
    expect(visibleResults(items, 'gogh', 'title')).toHaveLength(3);
  });
});
