import 'server-only';

/**
 * Delete one project: its storage objects first, then its rows (issue #22, FR-806, NFR-10).
 *
 * **This cannot be one transaction, and that was measured rather than assumed.** Supabase
 * installs a `protect_objects_delete` trigger on `storage.objects` that refuses any direct
 * `delete from storage.objects` — "Use the Storage API instead" — for every role including
 * `postgres`. So a `security definer` function cannot do it, and deletion is irreducibly two
 * systems. `test_projects_rls.py` pins that trigger's behaviour, because if it ever changes,
 * the single-transaction design becomes available and this compromise should be revisited.
 *
 * Given two systems, **order is the whole safety property**:
 *
 * - **Objects first, rows second.** A failure between them leaves rows citing bytes that are
 *   gone — visible, retryable, and safe, because a retry finds no objects and completes.
 * - **The reverse would fail into the bug this fixes.** Rows gone and bytes left is exactly
 *   defect (1) of #22: a deleted photograph that stays retrievable by its key, with no row left
 *   to tell anyone it should not be.
 *
 * The credential is the **artist's own token**, never `service_role`. Postgres answers the
 * ownership question through the same policies that decide every other read, and no
 * RLS-bypassing key enters an app runtime. That was a deliberate call over the alternative of
 * holding `service_role` here; the storage-side immutability it would have bought is instead
 * bought by the insert-claim guard in
 * `supabase/migrations/20260906181500_close_storage_object_lifecycle.sql`.
 */

import { REFERENCE_IMAGE_BUCKET } from './reference-images';

export interface DeleteProjectRequest {
  supabaseUrl: string;
  /** PostgREST requires an `apikey` header even when the bearer token is the real credential. */
  anonKey: string;
  /** The artist's Supabase access token, from the encrypted session. Never a service key. */
  accessToken: string;
  projectId: string;
  fetchImpl?: typeof fetch;
}

/**
 * Why a deletion did not complete.
 *
 * `not-found` covers both "no such project" and "not yours" without distinguishing them — the
 * same collapse `signed-url.ts` makes, for the same reason: an artist must not be able to probe
 * which project ids exist.
 *
 * `partial` is the one that must never be silent. It means storage reported deleting fewer
 * objects than were asked for, so the rows were deliberately left in place rather than being
 * removed on top of an incomplete storage delete.
 */
export type DeleteProjectFailure = 'not-found' | 'partial' | 'unavailable';

export type DeleteProjectResult =
  | { ok: true; deletedObjects: number }
  | { ok: false; reason: DeleteProjectFailure; status: number };

const restHeaders = ({ anonKey, accessToken }: { anonKey: string; accessToken: string }) => ({
  apikey: anonKey,
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
});

export const deleteProject = async ({
  supabaseUrl,
  anonKey,
  accessToken,
  projectId,
  fetchImpl = fetch,
}: DeleteProjectRequest): Promise<DeleteProjectResult> => {
  const base = supabaseUrl.replace(/\/+$/, '');
  const headers = restHeaders({ anonKey, accessToken });

  // 1. Establish that the project exists *for this caller*. Without this step, an id belonging
  //    to another artist would read as "yours, with no images" and report a successful deletion
  //    of nothing — a false success is worse than a refusal on a deletion path.
  let owned: Response;
  try {
    owned = await fetchImpl(`${base}/rest/v1/projects?id=eq.${projectId}&select=id`, { headers });
  } catch {
    return { ok: false, reason: 'unavailable', status: 0 };
  }
  if (!owned.ok) {
    return { ok: false, reason: 'unavailable', status: owned.status };
  }
  const projects = (await owned.json().catch(() => null)) as unknown[] | null;
  if (!Array.isArray(projects) || projects.length === 0) {
    return { ok: false, reason: 'not-found', status: 404 };
  }

  // 2. Ask the rows which objects exist. Listing the bucket by prefix would be the obvious
  //    alternative and is worse: the rows are the record of what this system wrote, so anything
  //    the listing turned up that no row cites would be deleted on a guess.
  let images: Response;
  try {
    images = await fetchImpl(
      `${base}/rest/v1/source_images?project_id=eq.${projectId}&select=storage_key`,
      { headers },
    );
  } catch {
    return { ok: false, reason: 'unavailable', status: 0 };
  }
  if (!images.ok) {
    return { ok: false, reason: 'unavailable', status: images.status };
  }
  const rows = (await images.json().catch(() => null)) as { storage_key?: unknown }[] | null;
  if (!Array.isArray(rows)) {
    return { ok: false, reason: 'unavailable', status: images.status };
  }
  const keys = rows
    .map((row) => row.storage_key)
    .filter((key): key is string => typeof key === 'string' && key.length > 0);

  // 3. Objects before rows. Storage answers with the array of what it actually removed, which
  //    is what makes a partial delete detectable rather than assumed.
  let deletedObjects = 0;
  if (keys.length > 0) {
    let removal: Response;
    try {
      removal = await fetchImpl(`${base}/storage/v1/object/${REFERENCE_IMAGE_BUCKET}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ prefixes: keys }),
      });
    } catch {
      return { ok: false, reason: 'unavailable', status: 0 };
    }
    if (!removal.ok) {
      return { ok: false, reason: 'unavailable', status: removal.status };
    }

    const removed = (await removal.json().catch(() => null)) as unknown[] | null;
    deletedObjects = Array.isArray(removed) ? removed.length : 0;

    if (deletedObjects !== keys.length) {
      // Stop here, and leave the rows. They are the only remaining record that these objects
      // were meant to be gone, and a retry uses them to finish the job. Deleting them now would
      // strand whatever storage kept, which is the defect this whole path exists to close.
      return { ok: false, reason: 'partial', status: removal.status };
    }
  }

  // 4. Rows last. `on delete cascade` takes `source_images` with the project; the trailing
  //    derivative tables will join that cascade as they are built, and need no change here.
  let rowRemoval: Response;
  try {
    rowRemoval = await fetchImpl(`${base}/rest/v1/projects?id=eq.${projectId}`, {
      method: 'DELETE',
      headers,
    });
  } catch {
    return { ok: false, reason: 'unavailable', status: 0 };
  }
  if (!rowRemoval.ok) {
    // Objects are gone and rows remain: retryable, and safe in the meantime because the bytes
    // a signed URL would have served no longer exist.
    return { ok: false, reason: 'unavailable', status: rowRemoval.status };
  }

  return { ok: true, deletedObjects };
};
