/**
 * The refusal vocabulary every studio route handler answers with.
 *
 * Two codes, deliberately — not three. The obvious third is `403` for "authenticated, but
 * this is not yours", and it is the one omitted on purpose:
 *
 * - **401** is the app's whole authentication boundary: no session, an unreadable session,
 *   or a session this surface does not accept (an `operator` cookie replayed against the
 *   studio). All three mean the same thing to a caller — *authenticate as an artist here* —
 *   and the page gate already collapses them the same way by redirecting to the login.
 * - **404** is every ownership failure. A signed-in artist asking for another artist's
 *   project must not be able to tell "exists, but not yours" from "does not exist", or the
 *   404 becomes an oracle for probing which project ids are real.
 *
 * The storage layer already reaches the same conclusion from the other side:
 * `signed-url.ts` maps both 400 and 404 to `not-found`, because "RLS makes 'not yours' and
 * 'not there' the same observable answer by design". This module keeps the HTTP surface
 * agreeing with the database rather than leaking a distinction Postgres refuses to make.
 *
 * No `server-only` import: middleware imports this on the Edge runtime, where that marker
 * fails the build.
 */

import { NextResponse } from 'next/server';

/** The closed set of machine-readable refusal codes. Widening it is an API change. */
export type ApiErrorCode = 'unauthenticated' | 'not_found';

interface ApiErrorBody {
  error: ApiErrorCode;
}

/**
 * No usable artist session on this surface.
 *
 * Deliberately says nothing about *why* — expired, absent, wrong role and malformed are one
 * answer, because distinguishing them tells an unauthenticated caller which cookies are
 * worth forging.
 */
export const unauthenticated = (): NextResponse<ApiErrorBody> =>
  NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

/**
 * The resource does not exist *for this artist*.
 *
 * Used for a genuinely missing row and for one owned by somebody else, without
 * distinguishing them. Callers must not be given a reason string that reintroduces the
 * difference.
 */
export const notFound = (): NextResponse<ApiErrorBody> =>
  NextResponse.json({ error: 'not_found' }, { status: 404 });
