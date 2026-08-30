import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Smoke coverage for the scaffold. The real state machine — acknowledgement checkbox,
 * error banner, focus move, cookie, and the gate redirect from the other apps — is
 * not built yet.
 */
test.describe('Entry point', {
  annotation: [
    { type: 'flow', description: 'platform.shell' },
    { type: 'category', description: 'functionality' },
  ],
}, () => {
  test('serves the landing page and negotiates a locale', async ({ page }) => {
    await page.goto('/');

    // `/` has no locale prefix; next-intl redirects to one.
    await expect(page).toHaveURL(/\/(en|es)$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('serves the Spanish locale', async ({ page }) => {
    await page.goto('/es');

    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    // Asserting the actual string, not just that a heading exists: the catalog could
    // fall back to English and a visibility check would still pass.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dos superficies, un estudio');
  });

  // Unlike the app surfaces there is no auth gate here, so a direct visit must
  // render rather than redirect to a login.
  test('does not gate the landing page behind a login', async ({ page }) => {
    const response = await page.goto('/en');

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/en$/);
  });

  test('has no detectable accessibility violations', {
    annotation: [{ type: 'category', description: 'a11y' }],
  }, async ({ page }) => {
    await page.goto('/en');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
