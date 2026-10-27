import 'server-only';
import { z } from 'zod';

const PAGE_SIZE = 24;
const projectSchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  intent: z.object({ medium: z.string(), time_budget_minutes: z.number() }).nullable(),
  source_images: z
    .object({ storage_key: z.string(), original_filename: z.string().nullable() })
    .nullable(),
  runs: z.array(z.object({ status: z.enum(['queued', 'running', 'succeeded', 'failed']) })),
});

export type SavedProject = z.infer<typeof projectSchema>;
export type ProjectLibrary =
  | { ok: true; projects: SavedProject[]; hasNext: boolean }
  | { ok: false };

/** List only rows visible to the signed-in artist. Embedded relationships also obey RLS. */
export const readProjects = async ({
  supabaseUrl,
  anonKey,
  accessToken,
  page = 1,
  fetchImpl = fetch,
}: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  page?: number;
  fetchImpl?: typeof fetch;
}): Promise<ProjectLibrary> => {
  const current = Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1;
  const query = new URLSearchParams({
    select: 'id,title,created_at,intent,source_images(storage_key,original_filename),runs(status)',
    order: 'created_at.desc,id.desc',
    limit: String(PAGE_SIZE + 1),
    offset: String((current - 1) * PAGE_SIZE),
    'runs.order': 'created_at.desc',
    'runs.limit': '1',
  });
  try {
    const response = await fetchImpl(
      `${supabaseUrl.replace(/\/$/, '')}/rest/v1/projects?${query}`,
      {
        headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      },
    );
    if (!response.ok) return { ok: false };
    const parsed = z.array(projectSchema).safeParse(await response.json());
    if (!parsed.success) return { ok: false };
    return {
      ok: true,
      projects: parsed.data.slice(0, PAGE_SIZE),
      hasNext: parsed.data.length > PAGE_SIZE,
    };
  } catch {
    return { ok: false };
  }
};
