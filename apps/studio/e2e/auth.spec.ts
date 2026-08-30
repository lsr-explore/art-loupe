import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Matches the demo credentials injected by the playwright webServer env
// (AUTH_PROVIDER=demo). Email-shaped because the identifier field is type="email" —
// "Artist ID" is a friendlier label over the same email credential,
// not a separate credential type.
const DEMO_USER = 'demo@demo.artloupestudio.com';
const DEMO_PASSWORD = 'demo-pass';

const signIn = async (page: import('@playwright/test').Page) => {
  await page.goto('/en');
  // No consent checkbox — the synthetic-data acknowledgement moved to the
  // entry point, and this suite arrives already holding its cookie (seeded in
  // playwright.config.ts). Reaching this screen at all means the gate let us through.
  await page.getByLabel('Artist ID').fill(DEMO_USER);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/home$/);
};

test.describe('Studio auth gate', {
  annotation: [
    { type: 'flow', description: 'platform.auth' },
    { type: 'category', description: 'security' },
  ],
}, () => {
  test('renders the public landing with no accessibility violations', {
    annotation: [{ type: 'category', description: 'a11y' }],
  }, async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Artist Studio - Log In');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('redirects the gated home to the landing when unauthenticated', async ({ page }) => {
    await page.goto('/en/home');
    await expect(page).toHaveURL(/\/en$/);
  });

  /**
   * Replaces "keeps sign-in disabled until the synthetic-data consent is given".
   *
   * The acknowledgement moved to the entry point, so the login screen is now
   * fields plus submit with nothing gating it. Asserting the absence
   * is what stops a future change quietly reintroducing a second ask here.
   */
  test('carries no acknowledgement checkbox and enables sign-in immediately', async ({ page }) => {
    await page.goto('/en');

    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  test('labels the identifier for an artist and carries no secondary links', async ({ page }) => {
    await page.goto('/en');

    await expect(page.getByLabel('Artist ID')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();

    // Request Access and Forgot Password are both removed, leaving
    // fields plus submit. Asserting on the card rather than the page keeps the
    // shell's own footer links out of the count.
    await expect(page.locator('[data-slot="card"]').getByRole('link')).toHaveCount(0);
  });

  test('serves the backdrop through the optimizer in a modern format', async ({ page }) => {
    await page.goto('/en');

    // Matched by filename rather than position: the optimizer rewrites the src to
    // `/_next/image?url=%2Fportal-backdrop.jpg&…`, so the name survives.
    const source = await page.locator('img[src*="portal-backdrop"]').getAttribute('src');
    // the raw JPEG is never the thing shipped; `next/image` rewrites
    // the src through the optimizer, which negotiates AVIF then WebP by `Accept`.
    expect(source).toContain('/_next/image');

    // Asked the way a browser asks. Playwright's request context sends `*/*`, which
    // gets the source JPEG back — that fallback is the feature, not a failure, so
    // the header has to be explicit or this asserts nothing. Either modern format is
    // accepted because the engines differ on AVIF and the negotiation is Next's job.
    const response = await page.request.get(source as string, {
      headers: { accept: 'image/avif,image/webp,*/*' },
    });
    expect(response.ok()).toBe(true);
    // Matched as a prefix, not compared for equality: a `content-type` is allowed to
    // carry parameters, so an exact match would break on `image/webp; q=0.9` without
    // anything actually being wrong.
    expect(response.headers()['content-type']).toMatch(/^image\/(avif|webp)\b/);
  });

  test('signs in, reaches the gated home, and bounces an authed user off the landing', async ({
    page,
  }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Studio');

    // A signed-in user visiting the landing is sent on to the home.
    await page.goto('/en');
    await expect(page).toHaveURL(/\/en\/home$/);

    // Sign out returns to the public landing.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('shows the signed-in identity in the header on every gated page', async ({ page }) => {
    await signIn(page);
    await expect(page.getByText(DEMO_USER)).toBeVisible();

    // The chip lives in the shared header, so identity and sign-out follow the
    // artist across gated pages rather than being re-declared per page. Only
    // `/home` is gated today — add each new gated route here as it lands, or this
    // stops proving anything about "every gated page".
    for (const path of ['/en/home']) {
      await page.goto(path);
      await expect(page.getByText(DEMO_USER)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    }
  });

  test('the authenticated header reflows at 320 CSS px', async ({ page }) => {
    // WCAG 2.2 AA, SC 1.4.10 Reflow: no two-dimensional scrolling at 320px. The
    // identity chip is the widest thing in the header, so it's what pushes the
    // control row over the budget if the row is ever pinned to one line again.
    await page.setViewportSize({ width: 320, height: 640 });
    await signIn(page);
    await page.reload();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(overflows).toBe(false);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('the authenticated home has no accessibility violations', {
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

/**
 * The app-side half of the acknowledgement gate.
 *
 * The rest of this file runs with the ack cookie seeded, which is the normal
 * arrival state — so nothing else here would notice if the gate stopped working.
 * This block drops the cookie to assert the redirect itself.
 *
 * Asserted at the HTTP layer rather than by navigating: following the redirect
 * would land on the entry point at :3003, which this config deliberately does not
 * start. The status and `Location` are the whole contract, and checking them keeps
 * the suite hermetic to this app. The entry point's own side is tested there.
 */
test.describe('the synthetic-data acknowledgement gate', {
  annotation: [
    { type: 'flow', description: 'platform.auth' },
    { type: 'category', description: 'security' },
  ],
}, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('redirects an unacknowledged visitor to the entry point with a resume link', async ({
    page,
  }) => {
    const response = await page.request.get('/en/home', { maxRedirects: 0 });

    expect(response.status()).toBe(307);

    const location = new URL(response.headers().location);
    expect(location.origin).toBe('http://localhost:3003');
    expect(location.searchParams.get('next')).toBe('http://localhost:3001/en/home');
  });

  // The login screen is gated too — the acknowledgement precedes authentication,
  // so an unacknowledged visitor never reaches it.
  test('gates the public landing as well, not just authenticated routes', async ({ page }) => {
    const response = await page.request.get('/en', { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain('localhost:3003');
  });
});
