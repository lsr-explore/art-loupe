/**
 * Layout arithmetic for `ImageGallery`, kept free of React so it can be tested directly.
 *
 * Two independent choices make four layouts:
 *
 * - **Engine** — CSS grid or CSS flexbox places the items.
 * - **Masonry** — off, every row is as tall as its tallest item; on, each item keeps its
 *   own height and items pack upward into the gaps.
 *
 * **DOM order is always the caller's order.** Keyboard focus and screen readers follow the
 * DOM, and the caller's order is meaningful (a sort by title or date). Both masonry
 * techniques here keep that order in the DOM and change only where items are drawn:
 *
 * - Grid masonry spans each item across tiny implicit rows in proportion to its height,
 *   so items still flow row by row.
 * - Flex masonry wraps a fixed-height column container and uses `order` to send item `i`
 *   to column `i % columns`. Reading across the columns then follows the DOM order.
 *
 * Plain CSS columns were rejected: they fill the first column top to bottom, so a sorted
 * list would read down, not across.
 */

export type GalleryEngine = 'grid' | 'flex';

export interface GalleryLayout {
  engine: GalleryEngine;
  masonry: boolean;
}

/** The implicit row height, in px, that grid masonry spans items across. */
export const GRID_ROW_UNIT = 1;

/** How many columns fit, at least one and at most `maxColumns`. */
export const columnCount = (
  width: number,
  minColumnWidth: number,
  gap: number,
  maxColumns: number,
): number => {
  if (width <= 0) return 1;
  const fit = Math.floor((width + gap) / (minColumnWidth + gap));
  return Math.max(1, Math.min(maxColumns, fit));
};

/**
 * Rows an item spans in grid masonry. The grid has no row gap, so the span includes the
 * gap below the item; that keeps vertical spacing equal to the horizontal gap.
 */
export const gridRowSpan = (height: number, gap: number): number =>
  Math.max(1, Math.ceil((height + gap) / GRID_ROW_UNIT));

/** The column item `index` is drawn in, for flex masonry. */
export const flexColumnOf = (index: number, columns: number): number => index % columns;

/**
 * The container height flex masonry needs: the tallest column, where a column holds the
 * items `flexColumnOf` assigns it plus the gaps between them. Rounded up so sub-pixel
 * heights cannot push the last item of a column into the next one.
 */
export const flexMasonryHeight = (heights: number[], columns: number, gap: number): number => {
  const totals = Array.from({ length: columns }, () => 0);
  const counts = Array.from({ length: columns }, () => 0);
  heights.forEach((height, index) => {
    const column = flexColumnOf(index, columns);
    totals[column] += height;
    counts[column] += 1;
  });
  const tallest = Math.max(
    0,
    ...totals.map((total, column) => total + gap * Math.max(0, counts[column] - 1)),
  );
  return Math.ceil(tallest) + 1;
};
