import 'server-only';
/**
 * Read one project for its page: the intent, the original, and the latest run.
 *
 * Read as the **artist**, through PostgREST, with their own token. RLS decides what is visible,
 * so this module holds no ownership logic, and a project that is absent and one that belongs to
 * somebody else are one answer: `null`, which the page turns into a 404.
 *
 * The latest run is read so that a reload reconnects to a run already in progress rather than
 * offering to start another. Only its id and status are needed here; everything else arrives on
 * the run's event stream, which replays from the start.
 */

export type ProjectRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ProjectView {
  projectId: string;
  /** Raw `ProjectIntent` JSON, as stored. `null` before intake has been submitted. */
  intent: Record<string, unknown> | null;
  /** `null` until a photograph has been uploaded. */
  original: { storageKey: string; widthPx: number; heightPx: number } | null;
  latestRun: { runId: string; status: ProjectRunStatus } | null;
}

export interface ReadProjectRequest {
  supabaseUrl: string;
  /** PostgREST requires an `apikey` header even when the bearer token is the real credential. */
  anonKey: string;
  /** The artist's Supabase access token, from the encrypted session. Never a service key. */
  accessToken: string;
  projectId: string;
  fetchImpl?: typeof fetch;
}

export type ReadProjectResult =
  | { ok: true; project: ProjectView }
  | { ok: false; reason: 'not-found' | 'unavailable' };

const RUN_STATUSES: readonly ProjectRunStatus[] = ['queued', 'running', 'succeeded', 'failed'];

export const readProject = async ({
  supabaseUrl,
  anonKey,
  accessToken,
  projectId,
  fetchImpl = fetch,
}: ReadProjectRequest): Promise<ReadProjectResult> => {
  const rest = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`;
  const headers = { apikey: anonKey, authorization: `Bearer ${accessToken}` };

  // A token PostgREST refuses outright (401) owns nothing it could read, so it is answered like
  // a project that is not there. A demo session's token, which Supabase did not sign, lands here.
  let refused = false;
  const select = async (path: string): Promise<Record<string, unknown>[] | null> => {
    const response = await fetchImpl(`${rest}/${path}`, { headers, cache: 'no-store' });
    if (response.status === 401) refused = true;
    if (!response.ok) return null;
    const rows: unknown = await response.json();
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null;
  };

  const id = encodeURIComponent(projectId);
  const [projects, originals, runs] = await Promise.all([
    select(`projects?id=eq.${id}&select=id,intent`),
    select(`source_images?project_id=eq.${id}&select=storage_key,width_px,height_px`),
    select(`runs?project_id=eq.${id}&select=id,status&order=created_at.desc&limit=1`),
  ]);

  if (refused) {
    return { ok: false, reason: 'not-found' };
  }
  if (projects === null || originals === null || runs === null) {
    return { ok: false, reason: 'unavailable' };
  }
  const [project] = projects;
  if (project === undefined) {
    return { ok: false, reason: 'not-found' };
  }

  const [original] = originals;
  const [run] = runs;
  const status = run?.status as ProjectRunStatus | undefined;

  return {
    ok: true,
    project: {
      projectId: String(project.id),
      intent: (project.intent as Record<string, unknown> | null) ?? null,
      original:
        original === undefined
          ? null
          : {
              storageKey: String(original.storage_key),
              widthPx: Number(original.width_px),
              heightPx: Number(original.height_px),
            },
      latestRun:
        run === undefined || status === undefined || !RUN_STATUSES.includes(status)
          ? null
          : { runId: String(run.id), status },
    },
  };
};
