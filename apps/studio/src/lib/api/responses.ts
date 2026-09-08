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
 * ## The third code, and why it does not break the rule above
 *
 * `422 invalid_upload` **does** carry a reason, which is the opposite of what the two codes
 * above do. The distinction is what the answer is about:
 *
 * - 401 and 404 describe *the system's* state — whether a session is good, whether a row
 *   exists, who owns it. Detail there is an oracle, because the caller learns something it
 *   could not otherwise know.
 * - `invalid_upload` describes *the bytes the caller just sent*, which they already have. A
 *   reason tells them nothing about anyone else's data, and FR-101 requires one: "anything
 *   else is refused with a reason". An artist whose 600 px photograph is rejected has to be
 *   able to find out that it was the size.
 *
 * The reason vocabulary is therefore closed and enumerated, so it cannot drift into carrying
 * anything derived from stored state.
 *
 * No `server-only` import: middleware imports this on the Edge runtime, where that marker
 * fails the build.
 */

import { NextResponse } from 'next/server';
import type { ApiErrorBody, UploadRejection } from './project-contract';

/**
 * The vocabulary itself lives in `project-contract.ts`, not here.
 *
 * The intake form and the Playwright stub both need these names, and neither can import a
 * module that constructs `NextResponse`. Splitting the types out is what lets the browser side
 * of the contract be written from the same declarations the handler answers with. Re-exported
 * so existing importers of this module are unaffected.
 */
export type { ApiErrorBody, ApiErrorCode, UploadRejection } from './project-contract';

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

/**
 * The submitted file or intent is not something this system accepts.
 *
 * 422 rather than 400: the request was well formed — correct method, parseable multipart, a
 * file part present — and it is the *content* that is unacceptable, which is exactly the
 * distinction 422 exists to make. A 400 would put a valid-but-refused photograph in the same
 * bucket as a malformed request body and make a client unable to tell whether retrying with a
 * different image could ever work.
 */
export const invalidUpload = (reason: UploadRejection): NextResponse<ApiErrorBody> =>
  NextResponse.json({ error: 'invalid_upload', reason }, { status: 422 });

/**
 * This artist has already uploaded these exact bytes to this project.
 *
 * Carries no reason string. Unlike `invalidUpload`, the fact being reported is about stored
 * state — a row that already exists — so the status code is the whole answer. It is safe to
 * report at all only because the state in question is the caller's own: RLS decided that
 * before this was reachable.
 */
export const conflict = (): NextResponse<ApiErrorBody> =>
  NextResponse.json({ error: 'conflict' }, { status: 409 });
