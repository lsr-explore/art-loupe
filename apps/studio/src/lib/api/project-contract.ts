/**
 * The wire shape of `POST /api/projects`, in one place that three consumers can all import.
 *
 * This exists because of a weakness that is specific to how the intake form is tested. The
 * Playwright suite stubs the upload at the browser with `page.route`, so the form's request
 * never reaches the handler — which means the *form-to-route contract* is asserted against a
 * hand-written fixture, and a change to the handler's response shape would leave the e2e suite
 * green while the real app broke. A stub written from the same exported names is not immune to
 * that, but it narrows it to a semantic change: rename the field, change the status, widen the
 * reason set, and the stub stops typechecking rather than stops meaning anything.
 *
 * So the endpoint path, the multipart field names, the refusal vocabulary and both body shapes
 * are declared here, and `route.ts`, `intake-form.tsx` and `e2e/intake.spec.ts` all read them
 * from this file rather than restating them.
 *
 * **No runtime imports, deliberately.** `responses.ts` builds `NextResponse` objects and is
 * therefore unreachable from a client component and from a Playwright spec. Everything here is
 * a type or a string constant, so the client bundle and the test process can hold it without
 * dragging `next/server` behind them.
 */

/** The endpoint the intake form posts to. Not locale-prefixed — route handlers never are. */
export const PROJECTS_ENDPOINT = '/api/projects';

/** The multipart field names the handler reads. Anything else in the body is ignored. */
export const FILE_FIELD = 'file';
export const INTENT_FIELD = 'intent';

/** The closed set of machine-readable refusal codes. Widening it is an API change. */
export type ApiErrorCode = 'unauthenticated' | 'not_found' | 'invalid_upload' | 'conflict';

/**
 * Why an upload was refused — a closed set, and never anything computed from stored state.
 *
 * Mirrors `ImageRejection` in `intake/inspect-image.ts` plus the two failures that belong to
 * the request rather than to the image.
 */
export type UploadRejection =
  | 'missing_file'
  | 'too_large'
  | 'unsupported_type'
  | 'undecodable'
  | 'below_min_dimension'
  | 'invalid_intent';

export interface ApiErrorBody {
  error: ApiErrorCode;
  reason?: UploadRejection;
}

/**
 * The 201 body.
 *
 * Identity only. No signed URL: the app reads originals back through the image route so
 * `img-src` stays `'self'` and the CSP is never widened.
 */
export interface CreateProjectResponse {
  projectId: string;
  checksum: string;
}
