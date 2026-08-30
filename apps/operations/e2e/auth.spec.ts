import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn } from './utils';

test.describe('Dashboard demo auth gate', {
  annotation: [
    { type: 'flow', description: 'platform.auth' },
    { type: 'category', description: 'security' },
  ],
}, () => {
  test('the authenticated header reflows at 320 CSS px', async ({ page }) => {
    // WCAG 2.2 AA, SC 1.4.10 Reflow: no two-dimensional scrolling at 320px.
    await page.setViewportSize({ width: 320, height: 640 });
    await signIn(page);
    await page.reload();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(overflows).toBe(false);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('renders the public landing with no accessibility violations', {
    annotation: [{ type: 'category', description: 'a11y' }],
  }, async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Operations Control - Log In');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('redirects the gated home to the landing when unauthenticated', async ({ page }) => {
    await page.goto('/en/home');
    await expect(page).toHaveURL(/\/en$/);
  });

  test('labels the console credentials for an operator and carries no secondary links', async ({
    page,
  }) => {
    await page.goto('/en');

    // The console's own wording over an ordinary Supabase email and
    // password. The reveal toggle takes the same wording, so it never announces a
    // "password" the screen does not mention.
    await expect(page.getByLabel('Operator ID')).toBeVisible();
    await expect(page.getByLabel('Access Key', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show access key' })).toBeVisible();

    // Fields plus submit, no secondary link at all.
    await expect(page.locator('[data-slot="card"]').getByRole('link')).toHaveCount(0);
  });

  test('signs in and reaches the gated operations home', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/en\/home$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Operations');
    // The dashboard panels are not built yet. Assert them here as they land, or
    // this only ever proves the gate opened.
  });

  test('the authenticated operations home has no accessibility violations', {
    annotation: [{ type: 'category', description: 'a11y' }],
  }, async ({ page }) => {
    await signIn(page);
    // Reload so axe audits the settled, fully-loaded document (title included)
    // rather than the transient state right after the post-login soft navigation.
    await page.reload();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
