import { expect, test } from '@playwright/test';

/**
 * Next serves these from the filesystem, outside the locale segment. They regressed once
 * already: the proxy matcher only excluded `favicon.ico` and `*.svg`, so everything else
 * here was sent through locale negotiation, redirected to `/en/...` and 404'd — which
 * meant the generated social card and iOS touch icon were unreachable in production while
 * still being referenced in the HTML. Nothing caught it, hence this file.
 *
 * These must NOT be locale-prefixed, so the assertion is a direct 200 with no redirect.
 */
const METADATA_ROUTES = [
  '/robots.txt',
  '/sitemap.xml',
  '/favicon.ico',
  '/icon.svg',
  '/apple-icon.png',
  '/opengraph-image.png',
];

test.describe('Metadata routes bypass locale negotiation', {
  annotation: [
    { type: 'flow', description: 'platform.shell' },
    { type: 'category', description: 'functionality' },
  ],
}, () => {
  for (const route of METADATA_ROUTES) {
    test(`${route} is served directly`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });

      expect(response.status(), `${route} should not redirect or 404`).toBe(200);
    });
  }
});
