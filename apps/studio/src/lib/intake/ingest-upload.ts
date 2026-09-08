import 'server-only';

/**
 * Take one uploaded photograph from bytes to a project the artist owns.
 *
 * This is the whole ingest path, held in one place so the route handler above it stays an HTTP
 * shell — the same division `delete-project.ts` makes with the DELETE handler.
 *
 * ## The order, which is the point
 *
 * 1. inspect the bytes (FR-101)
 * 2. screen the untrusted surfaces (FR-106, FR-803)
 * 3. checksum (FR-105)
 * 4. insert the `projects` row — nothing has a home until this has an id
 * 5. **upload the object**
 * 6. insert the `source_images` row
 * 7. insert the detections
 *
 * Steps 5 and 6 are the pair that cannot be swapped. `artloupe_reference_images_insert_own`
 * refuses a write to a key some `source_images` row already cites, so writing the row first
 * makes *every first upload* fail — with a bare storage permissions error that reads like a
 * broken policy rather than like a caller doing things backwards. The Python suite names this
 * directly in `test_the_guard_does_not_refuse_the_upload_that_creates_the_pair`.
 *
 * ## Nothing here is a transaction, so every step after 4 compensates
 *
 * Two systems again, exactly as in deletion. A failure at step 5 or 6 deletes the project row,
 * and the cascade takes anything already written beneath it; a failure at 5 also removes the
 * object it may have written. The artist gets an error and no half-made project.
 *
 * The one leak that is accepted: if compensation itself fails, an object survives that no row
 * cites. It is invisible to the artist, costs bytes, and is overwritten by an identical retry,
 * because the key ends in the content checksum. That is cheaper than the alternative, which is
 * holding `service_role` to guarantee cleanup — and no app runtime holds `service_role`.
 */

import { type Detection, type ProjectIntent, screenText, screenValues } from '@artloupe/schemas';
import { computeChecksum } from '@/lib/storage/checksum';
import { buildReferenceImageKey } from '@/lib/storage/reference-images';
import {
  deleteReferenceImageObject,
  uploadReferenceImage,
} from '@/lib/storage/upload-reference-image';
import { type ImageRejection, inspectImage } from './inspect-image';

/**
 * The rule id written for a surface nothing has looked at yet.
 *
 * OCR is not implemented in slice 1. Without this row an unscreened surface is
 * indistinguishable from a clean one, and the operations panel would report "no detections"
 * across three surfaces when only two were ever read — which is a stronger safety claim than
 * the system can support. Writing the gap down lets the panel say what is true.
 */
export const NOT_SCREENED_RULE_ID = 'surface-not-screened';

/** Surfaces this PR does not screen, recorded as gaps rather than left absent. */
const UNSCREENED_SURFACES = ['ocr'] as const;

export interface IngestUploadRequest {
  supabaseUrl: string;
  /** PostgREST requires an `apikey` header even when the bearer token is the real credential. */
  anonKey: string;
  /** The artist's Supabase access token, from the encrypted session. Never a service key. */
  accessToken: string;
  /** The artist's Supabase user id — the leading segment of every key they can read. */
  ownerId: string;
  /** UNTRUSTED (FR-106). Kept for provenance and screened; never used to build the key. */
  filename: string;
  bytes: Uint8Array;
  intent: ProjectIntent;
  fetchImpl?: typeof fetch;
}

/**
 * Why an ingest did not complete.
 *
 * `duplicate` is separated from every other storage refusal because it is the one that is not
 * a fault: the key ends in the content checksum, so a claimed key means this artist already
 * uploaded these exact bytes. Telling them they lacked permission would be wrong.
 *
 * **It is not reachable through the route as it stands, and that is worth knowing.** Every
 * POST creates a fresh project, so the key's middle segment is new every time and the same
 * photograph uploaded twice becomes two projects rather than a conflict — confirmed against
 * the live stack, not assumed. What this arm covers is a retry that races itself onto one
 * project id, and the day the route learns to replace the photograph in an *existing* project.
 * Collapsing it into `unavailable` would make that future change a silent wrong answer rather
 * than a case somebody already thought about.
 */
export type IngestFailure =
  | { kind: 'rejected'; reason: ImageRejection }
  | { kind: 'duplicate' }
  | { kind: 'unavailable'; status: number };

export interface IngestUploadSuccess {
  projectId: string;
  checksum: string;
  storageKey: string;
  detections: Detection[];
  /**
   * Whether the detections actually reached the table.
   *
   * Reported rather than thrown. A bookkeeping failure must not destroy a complete and correct
   * upload — but it must not vanish either: the ops panel under-reports when this is false, and
   * the OCR not-screened sentinel is exactly the row whose absence would make an unscreened
   * surface look clean again. The route logs it; only the caller has a logger.
   */
  detectionsRecorded: boolean;
}

export type IngestUploadResult =
  | { ok: true; result: IngestUploadSuccess }
  | { ok: false; failure: IngestFailure };

const restHeaders = ({ anonKey, accessToken }: { anonKey: string; accessToken: string }) => ({
  apikey: anonKey,
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
});

const unavailable = (status: number): IngestUploadResult => ({
  ok: false,
  failure: { kind: 'unavailable', status },
});

export const ingestUpload = async ({
  supabaseUrl,
  anonKey,
  accessToken,
  ownerId,
  filename,
  bytes,
  intent,
  fetchImpl = fetch,
}: IngestUploadRequest): Promise<IngestUploadResult> => {
  // 1. What is this, really? Decided from the bytes; the declared type is never consulted.
  const inspection = await inspectImage(bytes);
  if (!inspection.ok) {
    return { ok: false, failure: { kind: 'rejected', reason: inspection.reason } };
  }
  const image = inspection.inspection;

  // 2. Screen before anything is stored, and before any model could ever see it (FR-803).
  //    All three surfaces are screened even when they are empty, because "screened and clean"
  //    and "never looked at" have to stay distinguishable — that distinction is the whole
  //    reason the unscreened surfaces below are written down.
  const detections: Detection[] = [
    ...screenText('filename', filename),
    ...screenValues('exif', image.exif),
    ...screenText('project-goal', intent.goal ?? ''),
  ];

  // 3. FR-105. The identity every derivative, cache entry and measured claim will point at.
  const checksum = computeChecksum(bytes);

  const base = supabaseUrl.replace(/\/+$/, '');
  const headers = restHeaders({ anonKey, accessToken });

  // 4. The project row. `owner_id` is sent explicitly and RLS checks it against `auth.uid()`,
  //    so a mismatched value is refused rather than trusted.
  let created: Response;
  try {
    created = await fetchImpl(`${base}/rest/v1/projects`, {
      method: 'POST',
      headers: { ...headers, prefer: 'return=representation' },
      body: JSON.stringify({ owner_id: ownerId, intent }),
    });
  } catch {
    return unavailable(0);
  }
  if (!created.ok) {
    return unavailable(created.status);
  }

  const projectId = await readInsertedId(created);
  if (projectId === null) {
    return unavailable(created.status);
  }

  // The key is derived, never accepted. `buildReferenceImageKey` throws rather than returning a
  // fallback, and there is no safe default key — a caller that swallowed an error here would
  // write into a prefix its owner cannot reach.
  let storageKey: string;
  try {
    storageKey = buildReferenceImageKey({ ownerId, projectId, checksum });
  } catch {
    await discardProject({ base, headers, projectId, fetchImpl });
    return unavailable(0);
  }

  // 5. The object, BEFORE the row that cites it. See the module docblock.
  const uploaded = await uploadReferenceImage({
    supabaseUrl: base,
    accessToken,
    storageKey,
    bytes,
    contentType: image.mimeType,
    fetchImpl,
  });
  if (!uploaded.ok) {
    await discardProject({ base, headers, projectId, fetchImpl });
    if (uploaded.reason === 'already-claimed') {
      return { ok: false, failure: { kind: 'duplicate' } };
    }
    return unavailable(uploaded.status);
  }

  // 6. The row. Its check constraints restate FR-101 and FR-105, so a disagreement between
  //    what was inspected and what is stored fails here rather than becoming a wrong row.
  let stored: Response;
  try {
    stored = await fetchImpl(`${base}/rest/v1/source_images`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project_id: projectId,
        checksum,
        storage_key: storageKey,
        mime_type: image.mimeType,
        width_px: image.widthPx,
        height_px: image.heightPx,
        byte_size: image.byteSize,
        original_filename: filename,
        exif: image.exif,
      }),
    });
  } catch {
    await discardObjectAndProject({
      base,
      headers,
      accessToken,
      projectId,
      storageKey,
      fetchImpl,
    });
    return unavailable(0);
  }
  if (!stored.ok) {
    await discardObjectAndProject({
      base,
      headers,
      accessToken,
      projectId,
      storageKey,
      fetchImpl,
    });
    return unavailable(stored.status);
  }

  // 7. The detections, and the record of what was not looked at. Last on purpose: a failure
  //    here must not cost the artist a valid upload, so it is reported to the caller rather
  //    than unwinding a project that is otherwise complete and correct.
  const detectionsRecorded = await recordDetections({
    base,
    headers,
    projectId,
    detections,
    fetchImpl,
  });

  return {
    ok: true,
    result: { projectId, checksum, storageKey, detections, detectionsRecorded },
  };
};

/**
 * Pull the new project's id out of a `return=representation` response.
 *
 * `null` for any shape that is not one row carrying a string id. PostgREST answers an insert
 * with an array, and a caller that indexed into it blindly would turn an unexpected body into
 * `undefined` interpolated straight into a storage key.
 */
const readInsertedId = async (response: Response): Promise<string | null> => {
  const body: unknown = await response.json().catch(() => null);
  if (!Array.isArray(body) || body.length !== 1) {
    return null;
  }
  const row: unknown = body[0];
  if (row === null || typeof row !== 'object') {
    return null;
  }
  const id: unknown = (row as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

/**
 * Write the detections, and a sentinel row for every surface nothing looked at.
 *
 * One request. `on_conflict` makes a retry idempotent against the table's
 * `(project_id, surface, rule_id)` uniqueness, so re-ingesting after a partial failure does
 * not double the counts the operations panel reports.
 */
const recordDetections = async ({
  base,
  headers,
  projectId,
  detections,
  fetchImpl,
}: {
  base: string;
  headers: Record<string, string>;
  projectId: string;
  detections: Detection[];
  fetchImpl: typeof fetch;
}): Promise<boolean> => {
  const rows = [
    ...detections.map((detection) => ({
      project_id: projectId,
      surface: detection.surface,
      rule_id: detection.ruleId,
      severity: detection.severity,
      excerpt: detection.excerpt,
    })),
    ...UNSCREENED_SURFACES.map((surface) => ({
      project_id: projectId,
      surface,
      rule_id: NOT_SCREENED_RULE_ID,
      severity: 'none',
      excerpt: '',
    })),
  ];

  // Reported, never thrown, and never silently discarded — the two are different, and an
  // earlier version of this function did the second while its comment claimed the first. The
  // upload is complete and correct by now, so failing it here would destroy a valid project to
  // report a bookkeeping problem; but a `false` that nobody returns is a failure nobody can see.
  try {
    const written = await fetchImpl(
      `${base}/rest/v1/screening_detections?on_conflict=project_id,surface,rule_id`,
      {
        method: 'POST',
        headers: { ...headers, prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify(rows),
      },
    );
    return written.ok;
  } catch {
    return false;
  }
};

/** Undo step 4. The cascade takes anything already written beneath the project. */
const discardProject = async ({
  base,
  headers,
  projectId,
  fetchImpl,
}: {
  base: string;
  headers: Record<string, string>;
  projectId: string;
  fetchImpl: typeof fetch;
}): Promise<void> => {
  try {
    await fetchImpl(`${base}/rest/v1/projects?id=eq.${projectId}`, {
      method: 'DELETE',
      headers,
    });
  } catch {
    // Best effort; see the module docblock on the one leak that is accepted.
  }
};

/**
 * Undo steps 4 and 5 — object first, then rows.
 *
 * The same order deletion uses everywhere else in this app, for the reason `delete-project.ts`
 * gives at length: rows gone with bytes left behind is a deleted photograph that is still
 * retrievable by key, with no row left to say it should not be.
 */
const discardObjectAndProject = async ({
  base,
  headers,
  accessToken,
  projectId,
  storageKey,
  fetchImpl,
}: {
  base: string;
  headers: Record<string, string>;
  accessToken: string;
  projectId: string;
  storageKey: string;
  fetchImpl: typeof fetch;
}): Promise<void> => {
  await deleteReferenceImageObject({
    supabaseUrl: base,
    accessToken,
    storageKey,
    fetchImpl,
  });
  await discardProject({ base, headers, projectId, fetchImpl });
};
