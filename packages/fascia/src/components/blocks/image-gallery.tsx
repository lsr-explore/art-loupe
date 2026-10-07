'use client';
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react';

import {
  columnCount,
  flexColumnOf,
  flexMasonryHeight,
  type GalleryLayout,
  GRID_ROW_UNIT,
  gridRowSpan,
} from './gallery-layout';

export interface ImageGalleryProps<Item> {
  items: Item[];
  getKey: (item: Item) => string;
  renderItem: (item: Item) => ReactNode;
  layout: GalleryLayout;
  /** Accessible name for the list, e.g. "Search results". */
  label: string;
  /** Narrowest a column may get before one is dropped, in px. */
  minColumnWidth?: number;
  maxColumns?: number;
  /** Space between items, in px, both across and down. */
  gap?: number;
}

type Heights = Record<string, number>;

const sameHeights = (left: Heights, right: Heights) => {
  const keys = Object.keys(right);
  return keys.length === Object.keys(left).length && keys.every((key) => left[key] === right[key]);
};

/** Width of the list and height of each item. Measured in a layout effect so the first
 * paint already has the right column count, then kept current by a ResizeObserver: item
 * heights change as images load, and masonry has to follow them.
 */
const useGalleryMeasurements = (keySignature: string) => {
  const listRef = useRef<HTMLUListElement>(null);
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Heights>({});
  // keySignature is the dependency on purpose: re-observe whenever the item set changes.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const itemElements = () => list.querySelectorAll<HTMLElement>('[data-gallery-key]');
    const measure = () => {
      setWidth(list.getBoundingClientRect().width);
      const next: Heights = {};
      for (const element of itemElements())
        next[element.dataset.galleryKey ?? ''] = element.getBoundingClientRect().height;
      setHeights((previous) => (sameHeights(previous, next) ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const element of itemElements()) observer.observe(element);
    return () => observer.disconnect();
  }, [keySignature]);
  // Without an observer, heights are a one-off snapshot that goes stale as lazy images load.
  const canObserve = typeof ResizeObserver !== 'undefined';
  return { listRef, width, heights, canObserve };
};

/**
 * A list of items in one of four layouts: CSS grid or flexbox, with masonry on or off.
 * See `gallery-layout.ts` for why DOM order always stays the caller's order.
 *
 * Masonry needs every item's height, so it engages only once all items are measured.
 * Until then, and wherever ResizeObserver is unavailable, the same engine lays items out
 * in plain rows. Measuring there is valid: an item's width is the same in both modes.
 */
export const ImageGallery = <Item,>({
  items,
  getKey,
  renderItem,
  layout,
  label,
  minColumnWidth = 288,
  maxColumns = 3,
  gap = 20,
}: ImageGalleryProps<Item>) => {
  const keys = items.map(getKey);
  const { listRef, width, heights, canObserve } = useGalleryMeasurements(keys.join('\n'));
  const columns = columnCount(width, minColumnWidth, gap, maxColumns);
  const measured = canObserve && width > 0 && keys.every((key) => (heights[key] ?? 0) > 0);
  const masonry = layout.masonry && measured;
  const itemWidth = `calc((100% - ${(columns - 1) * gap}px) / ${columns})`;

  let listStyle: CSSProperties;
  let itemStyle: (key: string, index: number) => CSSProperties;
  if (layout.engine === 'grid') {
    listStyle = {
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      columnGap: gap,
      // Masonry spans tiny rows instead; its gap is inside each item's span.
      rowGap: masonry ? 0 : gap,
      gridAutoRows: masonry ? `${GRID_ROW_UNIT}px` : undefined,
    };
    itemStyle = (key) =>
      masonry
        ? // `start` keeps the item at its content height, so measuring it never feeds back.
          { gridRowEnd: `span ${gridRowSpan(heights[key] ?? 0, gap)}`, alignSelf: 'start' }
        : {};
  } else if (masonry) {
    listStyle = {
      display: 'flex',
      flexDirection: 'column',
      flexWrap: 'wrap',
      alignContent: 'flex-start',
      height: flexMasonryHeight(
        keys.map((key) => heights[key] ?? 0),
        columns,
        gap,
      ),
      rowGap: gap,
      // Each column is followed by a zero-width break line, so two half gaps make one.
      columnGap: gap / 2,
    };
    itemStyle = (_key, index) => ({ width: itemWidth, order: flexColumnOf(index, columns) });
  } else {
    listStyle = { display: 'flex', flexWrap: 'wrap', gap };
    itemStyle = () => ({ flex: `0 0 ${itemWidth}`, minWidth: 0 });
  }

  return (
    <ul
      ref={listRef}
      // Safari drops list semantics from a list without bullets unless the role is explicit.
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles
      role="list"
      aria-label={label}
      data-layout={`${layout.engine}${masonry ? '-masonry' : ''}`}
      className="m-0 list-none p-0"
      style={listStyle}
    >
      {items.map((item, index) => {
        const key = keys[index];
        return (
          <li key={key} data-gallery-key={key} className="min-w-0" style={itemStyle(key, index)}>
            {renderItem(item)}
          </li>
        );
      })}
      {layout.engine === 'flex' && masonry
        ? // Forced line breaks end each column. Same `order` as its column, and after its
          // items in the DOM, so it lands at the bottom of that column.
          Array.from({ length: columns - 1 }, (_, column) => (
            <li
              key={`gallery-break-${column}`}
              aria-hidden="true"
              style={{ flexBasis: '100%', width: 0, margin: 0, padding: 0, order: column }}
            />
          ))
        : null}
    </ul>
  );
};
