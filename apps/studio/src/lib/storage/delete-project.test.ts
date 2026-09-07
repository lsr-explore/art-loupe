// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// `server-only` throws outside a React Server Component; the module under test is server
// code either way, so the marker is stubbed rather than the behaviour changed.
vi.mock('server-only', () => ({}));

import { deleteProject } from './delete-project';
import {
  ACCESS_TOKEN,
  ANON_KEY,
  isImageLookup,
  isProjectDelete,
  isProjectLookup,
  isStorageDelete,
  jsonResponse,
  PROJECT_ID,
  STORAGE_KEY,
  SUPABASE_URL,
} from './delete-project.fixtures';

/** Records the order legs are called in, which is the property most of these tests are about. */
interface Stub {
  calls: string[];
  fetchImpl: typeof fetch;
}

const stubFetch = (
  overrides: {
    projects?: Response;
    images?: Response;
    storageDelete?: Response;
    projectDelete?: Response;
  } = {},
): Stub => {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (isProjectLookup(url)) {
      calls.push('lookup');
      return overrides.projects ?? jsonResponse([{ id: PROJECT_ID }]);
    }
    if (isImageLookup(url)) {
      calls.push('images');
      return overrides.images ?? jsonResponse([{ storage_key: STORAGE_KEY }]);
    }
    if (isStorageDelete(url)) {
      calls.push('storage-delete');
      return overrides.storageDelete ?? jsonResponse([{ name: STORAGE_KEY }]);
    }
    if (isProjectDelete(url)) {
      calls.push('row-delete');
      return overrides.projectDelete ?? new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request: ${url}`);
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
};

const run = (stub: Stub) =>
  deleteProject({
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    accessToken: ACCESS_TOKEN,
    projectId: PROJECT_ID,
    fetchImpl: stub.fetchImpl,
  });

// @trace flow=intake.project-intent category=data
describe('deleteProject', () => {
  describe('ordering — the safety property', () => {
    it('removes storage objects before rows', async () => {
      const stub = stubFetch();

      await expect(run(stub)).resolves.toEqual({ ok: true, deletedObjects: 1 });

      // Not incidental. Rows-then-objects would fail into exactly the defect being fixed: the
      // bytes stay retrievable by key with no row left to say they should not be.
      expect(stub.calls).toEqual(['lookup', 'images', 'storage-delete', 'row-delete']);
    });

    it('leaves the rows in place when storage deletes fewer objects than asked', async () => {
      // Storage answers with what it actually removed; two keys requested, one returned.
      const stub = stubFetch({
        images: jsonResponse([{ storage_key: STORAGE_KEY }, { storage_key: `${STORAGE_KEY}2` }]),
        storageDelete: jsonResponse([{ name: STORAGE_KEY }]),
      });

      await expect(run(stub)).resolves.toEqual({ ok: false, reason: 'partial', status: 200 });

      // The rows are the only remaining record that those objects were meant to be gone, and a
      // retry needs them. Deleting them on top of an incomplete storage delete strands the
      // remainder permanently.
      expect(stub.calls).not.toContain('row-delete');
    });
  });

  describe('the ownership boundary', () => {
    it('answers not-found for a project RLS does not show the caller', async () => {
      const stub = stubFetch({ projects: jsonResponse([]) });

      await expect(run(stub)).resolves.toEqual({ ok: false, reason: 'not-found', status: 404 });
      // Nothing is deleted, and — just as important — nothing is reported as deleted.
      expect(stub.calls).toEqual(['lookup']);
    });

    it('sends the artist token and never a service key', async () => {
      const stub = stubFetch();
      await run(stub);

      const [, init] = (stub.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((init as RequestInit).headers).toMatchObject({
        authorization: `Bearer ${ACCESS_TOKEN}`,
        apikey: ANON_KEY,
      });
    });
  });

  describe('projects with nothing stored', () => {
    it('still deletes the row when no image rows exist', async () => {
      const stub = stubFetch({ images: jsonResponse([]) });

      await expect(run(stub)).resolves.toEqual({ ok: true, deletedObjects: 0 });
      // No storage call at all — an empty prefix list would be a request to delete nothing.
      expect(stub.calls).toEqual(['lookup', 'images', 'row-delete']);
    });
  });

  describe('transport failures', () => {
    it('reports unavailable when storage refuses, without touching rows', async () => {
      const stub = stubFetch({ storageDelete: new Response(null, { status: 503 }) });

      await expect(run(stub)).resolves.toEqual({
        ok: false,
        reason: 'unavailable',
        status: 503,
      });
      expect(stub.calls).not.toContain('row-delete');
    });

    it('reports unavailable when the row delete fails after storage succeeded', async () => {
      const stub = stubFetch({ projectDelete: new Response(null, { status: 500 }) });

      // Recoverable by design: the bytes are gone, so nothing is retrievable in the meantime,
      // and a retry finds no objects and completes the row removal.
      await expect(run(stub)).resolves.toEqual({
        ok: false,
        reason: 'unavailable',
        status: 500,
      });
      expect(stub.calls).toEqual(['lookup', 'images', 'storage-delete', 'row-delete']);
    });
  });
});
