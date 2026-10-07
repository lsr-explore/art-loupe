import { describe, expect, it } from 'vitest';

import { columnCount, flexColumnOf, flexMasonryHeight, gridRowSpan } from './gallery-layout';

// @trace flow=inspiration.search category=functionality
describe('inspiration.search: gallery layout arithmetic', () => {
  it('fits as many columns as the width allows, within bounds', () => {
    expect(columnCount(0, 288, 20, 3)).toBe(1);
    expect(columnCount(500, 288, 20, 3)).toBe(1);
    expect(columnCount(596, 288, 20, 3)).toBe(2);
    expect(columnCount(2000, 288, 20, 3)).toBe(3);
  });
  it('spans grid rows for the item height plus one gap', () => {
    expect(gridRowSpan(300, 20)).toBe(320);
    expect(gridRowSpan(300.2, 20)).toBe(321);
    expect(gridRowSpan(0, 0)).toBe(1);
  });
  it('sends items across the columns in DOM order', () => {
    expect([0, 1, 2, 3, 4].map((index) => flexColumnOf(index, 3))).toEqual([0, 1, 2, 0, 1]);
  });
  it('sizes the flex container to the tallest column, gaps included', () => {
    // Columns: [100, 400], [200, 50], [300] -> 100 + 20 + 400 = 520 is tallest.
    expect(flexMasonryHeight([100, 200, 300, 400, 50], 3, 20)).toBe(521);
    expect(flexMasonryHeight([], 3, 20)).toBe(1);
  });
});
