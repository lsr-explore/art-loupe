import { expect, type Page } from '@playwright/test';

/**
 * Sign in through the demo auth gate and land on the gated ops home. Shared by the
 * e2e specs so the login flow lives in one place and doesn't drift.
 */
export const signIn = async (page: Page) => {
  await page.goto('/en');
  // No consent checkbox — the acknowledgement moved to the entry point
  // and this suite arrives holding its cookie (seeded in playwright.config.ts).
  // "Operator ID" / "Access Key" are the console's wording for an ordinary email and
  // password. The identifier is email-shaped because the field is
  // `type="email"` — and because this suite's demo provider stands in for Supabase,
  // where the identifier genuinely is an address. It must match `DEMO_AUTH_USERNAME`
  // in `.env.test`.
  await page.getByLabel('Operator ID').fill('demo@demo.artloupestudio.com');
  await page.getByLabel('Access Key', { exact: true }).fill('demo-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/home$/);
};
