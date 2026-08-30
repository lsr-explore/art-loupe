import type { Role } from '@artloupe/auth';
import { acknowledgementRedirectUrl, hasAcknowledged } from '@artloupe/auth/ack';
import { getSessionFromRequest } from '@artloupe/auth/middleware';
import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { env } from '@/env';
import { routing } from '@/i18n/routing';

const intlMiddleware = createMiddleware(routing);

/** Path segments (after the locale) reachable without a session. '' is the landing. */
const PUBLIC_PATHS = new Set(['']);

/**
 * Roles allowed into this app. The studio is artist-facing;
 * `superuser` retains full access. A session with any other role (e.g. an operator
 * cross-app cookie) is treated as unauthorized here so the apps stay separated.
 */
const ALLOWED_ROLES = new Set<Role>(['artist', 'superuser']);

const isKnownLocale = (segment: string): segment is (typeof routing.locales)[number] =>
  routing.locales.includes(segment as (typeof routing.locales)[number]);

export const proxy = async (request: NextRequest) => {
  const response = intlMiddleware(request);

  // next-intl may redirect to add/normalize the locale prefix (e.g. `/` → `/en`).
  // Let that happen; the follow-up request re-enters here with a locale to gate.
  if (response.headers.has('location')) {
    return response;
  }

  // The acknowledgement gate runs *before* the auth gate, and applies to
  // public paths too: an unacknowledged visitor must reach the entry point rather
  // than this app's login screen, which no longer carries a consent checkbox of its
  // own. Deep links resume via `?next=`.
  if (!hasAcknowledged(request)) {
    return NextResponse.redirect(
      acknowledgementRedirectUrl({
        request,
        entryOrigin: env.NEXT_PUBLIC_ENTRY_URL ?? 'http://localhost:3003',
        appOrigin: env.NEXT_PUBLIC_APP_URL,
      }),
    );
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const locale = isKnownLocale(segments[0]) ? segments[0] : routing.defaultLocale;
  const subPath = segments.slice(1).join('/');

  const session = await getSessionFromRequest(request, response);
  const authorized = session !== null && ALLOWED_ROLES.has(session.role);
  const isPublic = PUBLIC_PATHS.has(subPath);

  if (!isPublic && !authorized) {
    return NextResponse.redirect(new URL(`/${locale}`, request.url));
  }

  if (isPublic && authorized) {
    return NextResponse.redirect(new URL(`/${locale}/home`, request.url));
  }

  return response;
};

export const config = {
  // Anything with a file extension is excluded, not just favicon.ico and *.svg. Next
  // serves robots.txt, sitemap.xml, opengraph-image.png and apple-icon.png from the
  // filesystem, and the narrower matcher sent all of them through locale negotiation —
  // /opengraph-image.png redirected to /en/opengraph-image.png and 404'd, so every
  // social card and iOS touch icon was unreachable.
  matcher: ['/((?!api|_next/static|_next/image|.*\\..*).*)'],
};
