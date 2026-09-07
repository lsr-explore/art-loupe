import type { Role } from '@artloupe/auth';
import { acknowledgementRedirectUrl, hasAcknowledged } from '@artloupe/auth/ack';
import { getSessionFromRequest } from '@artloupe/auth/middleware';
import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { env } from '@/env';
import { routing } from '@/i18n/routing';
import { unauthenticated } from '@/lib/api/responses';

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

/** Route handlers live at `app/api`, outside `app/[locale]` — they are never locale-prefixed. */
const API_PREFIX = '/api';

const isApiPath = (pathname: string): boolean =>
  pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);

/**
 * Gate a route-handler request.
 *
 * Separate from the page chain for two reasons, and both are about what a caller can act on:
 *
 * - **A redirect is useless to an XHR.** `fetch` follows a 302 transparently, so a page-style
 *   bounce to the login hands the caller a 200 carrying HTML where it expected JSON. The only
 *   answer a client can branch on is a status code.
 * - **Locale negotiation does not apply.** `/api/...` has no locale segment, and running it
 *   through `next-intl` would redirect `/api/images/x` to `/en/api/images/x`, which routes
 *   nowhere. This branch returns before `intlMiddleware` is ever called.
 *
 * The acknowledgement gate is deliberately **not** applied here. It is a synthetic-data
 * disclaimer about what the UI shows (`packages/auth/src/ack.ts`: "a demo disclaimer, not a
 * consent record"), and no studio page renders without it — so any request reaching a handler
 * came from a surface that already displayed it. Keeping it out also means issue #27, which
 * moves the notice to the login page, does not have to touch route handlers at all.
 *
 * Ownership is not decided here and cannot be: middleware does not know who owns a given
 * project. This establishes only that the caller is an artist on this surface; the 404 half of
 * the vocabulary belongs to each handler, answered from RLS.
 */
const gateApiRequest = async (request: NextRequest): Promise<NextResponse> => {
  // `getSessionFromRequest` only reads, but iron-session needs a response to write to if
  // anything ever calls `.save()`. This one is returned on the authorized path.
  const response = NextResponse.next();
  const session = await getSessionFromRequest(request, response);

  if (session === null || !ALLOWED_ROLES.has(session.role)) {
    return unauthenticated();
  }

  return response;
};

export const proxy = async (request: NextRequest) => {
  // Before locale negotiation, deliberately — see `gateApiRequest`.
  if (isApiPath(request.nextUrl.pathname)) {
    return gateApiRequest(request);
  }

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
  // `api` was excluded here, which meant route handlers ran with no gate whatsoever — not
  // "gated by default", but never seen by this file at all. It is now inside the matcher and
  // takes the `gateApiRequest` branch above.
  matcher: ['/((?!_next/static|_next/image|.*\\..*).*)'],
};
