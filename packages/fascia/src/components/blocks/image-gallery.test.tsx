import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { GalleryLayout } from './gallery-layout';
import { ImageGallery } from './image-gallery';

const items = [
  { id: 'a', height: 100 },
  { id: 'b', height: 200 },
  { id: 'c', height: 300 },
  { id: 'd', height: 400 },
];
const gallery = (layout: GalleryLayout) =>
  render(
    <ImageGallery
      items={items}
      getKey={(item) => item.id}
      renderItem={(item) => <p>{item.id}</p>}
      layout={layout}
      label="Images"
    />,
  );
const listItems = () => screen.getAllByRole('listitem');

// jsdom has no layout. Give the list a 1000 px width and each item its fixture height,
// and a ResizeObserver that never fires (the layout effect measures once on mount).
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const item = items.find((entry) => entry.id === this.dataset.galleryKey);
    return { width: item ? 320 : 1000, height: item?.height ?? 0 } as DOMRect;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// @trace flow=inspiration.search category=functionality
describe('inspiration.search: image gallery', () => {
  it('keeps the caller order in the DOM in every layout', () => {
    for (const engine of ['grid', 'flex'] as const)
      for (const masonry of [false, true]) {
        const { unmount } = gallery({ engine, masonry });
        expect(listItems().map((item) => item.textContent)).toEqual(['a', 'b', 'c', 'd']);
        unmount();
      }
  });
  it('lays out a plain grid with equal rows', () => {
    gallery({ engine: 'grid', masonry: false });
    const list = screen.getByRole('list', { name: 'Images' });
    expect(list).toHaveAttribute('data-layout', 'grid');
    expect(list.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(listItems()[0].style.gridRowEnd).toBe('');
  });
  it('spans grid rows by measured height in grid masonry', () => {
    gallery({ engine: 'grid', masonry: true });
    expect(screen.getByRole('list')).toHaveAttribute('data-layout', 'grid-masonry');
    expect(listItems().map((item) => item.style.gridRowEnd)).toEqual([
      'span 120',
      'span 220',
      'span 320',
      'span 420',
    ]);
  });
  it('wraps flexible rows', () => {
    gallery({ engine: 'flex', masonry: false });
    expect(screen.getByRole('list')).toHaveAttribute('data-layout', 'flex');
    // jsdom normalizes calc(); the point is three columns sharing two 20 px gaps.
    expect(listItems()[0].style.flex).toContain('100% - 40px');
  });
  it('orders flex masonry items into columns with hidden column breaks', () => {
    const { container } = gallery({ engine: 'flex', masonry: true });
    const list = screen.getByRole('list');
    expect(list).toHaveAttribute('data-layout', 'flex-masonry');
    // Columns: [100, 400], [200], [300] -> 100 + 20 + 400 = 520.
    expect(list.style.height).toBe('521px');
    expect(listItems().map((item) => item.style.order)).toEqual(['0', '1', '2', '0']);
    expect(container.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(2);
  });
  it('falls back to plain rows until every item is measured', () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    gallery({ engine: 'grid', masonry: true });
    expect(screen.getByRole('list')).toHaveAttribute('data-layout', 'grid');
  });
  // @trace category=a11y
  it('has no axe violations in flex masonry, breaks included', async () => {
    const { container } = gallery({ engine: 'flex', masonry: true });
    expect(await axe(container)).toHaveNoViolations();
  });
});
