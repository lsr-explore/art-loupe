import createMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

/**
 * Locale negotiation only.
 *
 * Unlike the three app surfaces, the entry point has **no auth gate** — it is never
 * authenticated, so there is no session to read and nothing to redirect to a login.
 * It also does not check the acknowledgement cookie: the
 * entry point is where that cookie gets *set*, so gating it on its own cookie would
 * lock the door from the inside.
 *
 * The acknowledgement gate is the mirror image of this — middleware in the *other*
 * three apps redirecting here when the cookie is absent. Not built yet.
 */
export const proxy = createMiddleware(routing);

export const config = {
  // Anything with a file extension is excluded, not just favicon.ico and *.svg. Next
  // serves robots.txt, sitemap.xml, opengraph-image.png and apple-icon.png from the
  // filesystem, and the narrower matcher sent all of them through locale negotiation —
  // /opengraph-image.png redirected to /en/opengraph-image.png and 404'd, so every
  // social card and iOS touch icon was unreachable.
  matcher: ['/((?!api|_next/static|_next/image|.*\\..*).*)'],
};
