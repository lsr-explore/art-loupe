import type { InspirationResponse } from '@artloupe/schemas/inspiration';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { settleTransitions } from './settle';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const result: InspirationResponse = {
  items: [
    {
      id: 'met:1',
      source: 'met',
      title: 'Sunflowers',
      creator: 'Vincent van Gogh',
      medium: 'Oil on canvas',
      date: '1887',
      year: 1887,
      alt: 'Sunflowers by Vincent van Gogh',
      image_url: 'https://images.metmuseum.org/a.jpg',
      source_url: 'https://www.metmuseum.org/art/collection/search/1',
    },
  ],
  page: 1,
  has_more: false,
  partial: false,
  stale: false,
};
const open = async (page: Page) => {
  await page.goto('/en');
  await page.getByLabel('Artist ID').fill('demo@demo.artloupestudio.com');
  await page.getByLabel('Password', { exact: true }).fill('demo-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Get inspired' }).click();
};
test.describe('Get inspired', {
  annotation: [
    { type: 'flow', description: 'inspiration.search' },
    { type: 'category', description: 'functionality' },
  ],
}, () => {
  test('switches among the four gallery layouts in a real layout engine, passing axe', async ({
    page,
  }) => {
    // Five paintings with different proportions (width:height), so masonry has uneven
    // columns to pack. jsdom cannot measure any of this.
    const ratios = [
      [3, 5],
      [3, 1],
      [3, 2],
      [1, 1],
      [2, 1],
    ];
    const many: InspirationResponse = {
      ...result,
      items: ratios.map((_, index) => ({
        ...result.items[0],
        id: `met:${index + 1}`,
        title: `Painting ${index + 1}`,
        alt: `Painting ${index + 1}`,
        image_url: `https://images.metmuseum.org/${index}.svg`,
      })),
    };
    await page.route('**/api/inspiration?**', (route) => route.fulfill({ json: many }));
    await page.route('https://images.metmuseum.org/**', (route) => {
      const [width, height] =
        ratios[
          Number(
            route
              .request()
              .url()
              .match(/(\d+)\.svg$/)?.[1],
          )
        ];
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 100}" height="${height * 100}"><rect width="100%" height="100%" fill="#888"/></svg>`,
      });
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page);
    await page.getByLabel('Collection', { exact: true }).selectOption('met');
    await page.getByLabel('Keywords', { exact: true }).fill('flowers');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const list = page.getByRole('list', { name: 'Images' });
    const items = list.getByRole('listitem');
    await expect(items).toHaveCount(5);
    const boxes = () =>
      items.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
        }),
      );
    const overlaps = async () => {
      const all = await boxes();
      return all.some((one, index) =>
        all
          .slice(index + 1)
          .some(
            (two) =>
              one.left < two.right - 1 &&
              two.left < one.right - 1 &&
              one.top < two.bottom - 1 &&
              two.top < one.bottom - 1,
          ),
      );
    };
    const layout = page.getByLabel('Layout', { exact: true });
    const masonry = page.getByLabel("Masonry (keep each image's proportions)");
    for (const [engine, packed, expected] of [
      ['grid', false, 'grid'],
      ['grid', true, 'grid-masonry'],
      ['flex', true, 'flex-masonry'],
      ['flex', false, 'flex'],
    ] as const) {
      await layout.selectOption(engine);
      await masonry.setChecked(packed);
      await expect(list).toHaveAttribute('data-layout', expected);
      // Wait for every image to load, then for the layout to settle around it.
      await expect
        .poll(() =>
          list
            .locator('img')
            .evaluateAll((images) =>
              images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
            ),
        )
        .toBe(true);
      await expect.poll(overlaps).toBe(false);
      const [first, second, third, fourth] = await boxes();
      // Three columns at this width, and the first three items share a top edge.
      expect(new Set([first, second, third].map((box) => Math.round(box.top))).size).toBe(1);
      if (!packed) {
        // Plain rows: the fourth item starts a new row below the tallest of the first three.
        expect(fourth.top).toBeGreaterThanOrEqual(
          Math.max(first.bottom, second.bottom, third.bottom),
        );
      } else {
        // Masonry: the fourth item packs 20 px under a column instead of under the row.
        const above =
          engine === 'flex'
            ? first // flex masonry sends item 4 to column 1
            : [first, second, third].reduce((low, box) => (box.bottom < low.bottom ? box : low));
        expect(Math.round(fourth.left)).toBe(Math.round(above.left));
        expect(Math.abs(fourth.top - (above.bottom + 20))).toBeLessThanOrEqual(2);
      }
      await settleTransitions(page);
      expect(
        (
          await new AxeBuilder({ page })
            .include('section')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
  });
  test('searches one source, filters locally, and supports keyboard navigation and axe', async ({
    page,
  }, testInfo) => {
    let calls = 0;
    await page.route('**/api/inspiration?**', (route) => {
      calls++;
      expect(new URL(route.request().url()).searchParams.get('source')).toBe('met');
      return route.fulfill({ json: result });
    });
    await page.route('https://images.metmuseum.org/**', (route) =>
      route.fulfill({ contentType: 'image/png', body: png }),
    );
    await open(page);
    const source = page.getByLabel('Collection', { exact: true });
    await source.focus();
    await expect(source).toBeFocused();
    await source.selectOption('met');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Keywords', { exact: true })).toBeFocused();
    await page.getByLabel('Keywords', { exact: true }).fill('flowers');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sunflowers' })).toBeVisible();
    await expect(page.getByText('Oil on canvas')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('get-inspired-light.png'), fullPage: true });
    const before = calls;
    await page.getByLabel('Filter loaded results').fill('no match');
    await expect(
      page.getByText('No loaded images match your filter.', { exact: false }),
    ).toBeVisible();
    expect(calls).toBe(before);
    await page.getByLabel('Filter loaded results').fill('');
    await expect(page.getByRole('img', { name: 'Sunflowers by Vincent van Gogh' })).toBeVisible();
    await settleTransitions(page);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await settleTransitions(page);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('get-inspired-dark.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 640 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
  });
  test('explains an outage and recovers on retry; error state passes axe', async ({ page }) => {
    let fail = true;
    await page.route('**/api/inspiration?**', (route) =>
      route.fulfill({
        status: fail ? 503 : 200,
        json: fail ? { error: 'search_unavailable' } : { ...result, items: [] },
      }),
    );
    await open(page);
    await page.getByLabel('Keywords', { exact: true }).fill('flowers');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'temporarily unavailable' }),
    ).toBeVisible();
    await settleTransitions(page);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    fail = false;
    await page.getByRole('button', { name: 'Retry search' }).click();
    await expect(
      page.getByText('No displayable images found in this batch.', { exact: false }),
    ).toBeVisible();
  });
});
