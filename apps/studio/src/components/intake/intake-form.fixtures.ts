/**
 * Fixtures for the intake form's suite.
 *
 * Kept out of the test file so the Playwright spec and any later suite can reach the same
 * shapes — the point of the exercise is that the browser side of the contract is written from
 * one set of declarations rather than retyped per test.
 */

import { MAX_UPLOAD_BYTES } from '@artloupe/schemas/image-limits';
import type { CreateProjectResponse, UploadRejection } from '@/lib/api/project-contract';

/** A real, if minimal, PNG signature. The form never decodes it; the server does. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const PROJECT_ID = '3f1c9b4e-2d7a-4c05-9f8b-6a1e0d2c4b57';
export const CHECKSUM = 'a'.repeat(64);

export const referencePhotograph = (name = 'studio-reference.png'): File =>
  new File([PNG_BYTES], name, { type: 'image/png' });

/**
 * A photograph past the FR-101 ceiling, without allocating 25 MB to say so.
 *
 * `size` is redefined rather than filled, because the assertion is about the check the form
 * makes on the number, and materialising the bytes would only make the suite slower. Nothing
 * in the form reads the content — that is the server's job, from the real bytes.
 */
export const oversizedPhotograph = (): File => {
  const file = referencePhotograph('enormous.png');
  Object.defineProperty(file, 'size', { value: MAX_UPLOAD_BYTES + 1 });
  return file;
};

/** The values a well-formed intake carries, as the artist would type them. */
export const VALID_ENTRY = {
  medium: 'graphite',
  timeBudgetMinutes: '180',
  supportWidth: '9',
  supportHeight: '12',
  supportUnits: 'in',
  skillLevel: 'advanced',
  goal: 'likeness matters more than finish',
} as const;

/**
 * A minimal stand-in for `Response`.
 *
 * Only `status` and `json()` are read by the form, and building the real thing would pull a
 * fetch implementation into a jsdom environment that has no need of one.
 */
const stubResponse = (status: number, body: unknown): Response =>
  ({ status, json: async () => body }) as Response;

export const createdResponse = (projectId: string = PROJECT_ID): Response =>
  stubResponse(201, { projectId, checksum: CHECKSUM } satisfies CreateProjectResponse);

export const refusalResponse = (reason: UploadRejection): Response =>
  stubResponse(422, { error: 'invalid_upload', reason });

/** A refusal that carries no reason at all — the arm that must not render "undefined". */
export const unreasonedRefusal = (): Response => stubResponse(422, { error: 'invalid_upload' });

/**
 * A 201 whose body will not decode — an empty, truncated or malformed reply.
 *
 * `json()` rejects rather than resolving to `null`, because that is what a real `Response`
 * does: a stub that resolved would not exercise the rejection path at all, which is the one
 * that used to escape the submit handler.
 */
export const undecodableCreation = (): Response =>
  ({
    status: 201,
    // Annotated `Promise<unknown>`: an unannotated throwing body infers `Promise<never>`,
    // which does not overlap `Response['json']` and fails the cast.
    json: async (): Promise<unknown> => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  }) as Response;

/** A 201 that decodes but names no project — the quieter half of the same hole. */
export const creationWithoutId = (): Response => stubResponse(201, { checksum: CHECKSUM });

export const statusResponse = (status: number, error: string): Response =>
  stubResponse(status, { error });
