import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import fixture from '../../../packages/schemas/fixtures/learning-parity.json';
import { settleTransitions } from './settle';

test.describe(
  'Learning assistant',
  {
    annotation: [
      { type: 'flow', description: 'retrieval.grounding' },
      { type: 'category', description: 'a11y' },
    ],
  },
  () => {
    test('opens cited passages on mobile and desktop without layout overflow', async ({
      page,
    }, info) => {
      await page.route('**/api/learning', (route) => route.fulfill({ json: fixture.answer }));
      await page.goto('/en');
      await page.getByLabel('Artist ID').fill('demo@demo.artloupestudio.com');
      await page.getByLabel('Password', { exact: true }).fill('demo-pass');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('link', { name: 'Ask the learning assistant' }).click();
      await page.getByLabel('Your question').fill('What is value?');
      await page.getByRole('button', { name: 'Ask', exact: true }).click();
      await expect(page.getByText('Value describes relative lightness or darkness.')).toBeVisible();
      await page.getByRole('link', { name: 'Read supporting passage 1' }).click();
      await expect(page.getByText(fixture.answer.sources[0].excerpt)).toBeVisible();
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await settleTransitions(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
              .analyze()
          ).violations,
        ).toEqual([]);
        await page.screenshot({ path: info.outputPath(`learning-${width}.png`), fullPage: true });
      }
    });
  },
);
