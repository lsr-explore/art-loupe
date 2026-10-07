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
    // Several paintings, so masonry has columns to pack; jsdom cannot measure this.
    const many: InspirationResponse = {
      ...result,
      items: Array.from({ length: 5 }, (_, index) => ({
        ...result.items[0],
        id: `met:${index + 1}`,
        title: `Painting ${index + 1}`,
        alt: `Painting ${index + 1}`,
      })),
    };
    await page.route('**/api/inspiration?**', (route) => route.fulfill({ json: many }));
    await page.route('https://images.metmuseum.org/**', (route) =>
      route.fulfill({ contentType: 'image/png', body: png }),
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page);
    await page.getByLabel('Collection', { exact: true }).selectOption('met');
    await page.getByLabel('Keywords', { exact: true }).fill('flowers');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const list = page.getByRole('list', { name: 'Images' });
    await expect(list.getByRole('listitem')).toHaveCount(5);
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
      // Three columns at this width: the first three items share a top edge.
      const tops = await list
        .getByRole('listitem')
        .evaluateAll((items) => items.slice(0, 3).map((item) => item.getBoundingClientRect().top));
      expect(new Set(tops.map(Math.round)).size).toBe(1);
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
