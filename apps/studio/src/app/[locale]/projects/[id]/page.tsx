import { peekAccessToken } from '@artloupe/auth/server';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { logout } from '@/app/[locale]/actions';
import { RunPanel } from '@/components/project/run-panel';
import { env } from '@/env';
import { Link } from '@/i18n/navigation';
import { readProject } from '@/lib/projects/read-project';

/**
 * One project: its reference photograph, and the analysis the artist can start and follow.
 *
 * **It reads the project as the artist.** `readProject` asks PostgREST with the artist's own
 * token, so RLS answers whether this project is theirs, and a project that is absent and one
 * that is somebody else's are the same 404 the rest of the app returns. A session whose token
 * Supabase refuses, such as the demo provider's, owns nothing and gets that 404 too.
 *
 * The token is only peeked at. A Server Component cannot write cookies, so the refresh-or-destroy
 * path in `getAccessToken` would throw here. An expired token gets a notice with the sign-out
 * action instead, which runs where the cookie can be cleared, and leads back to sign-in.
 *
 * The id is checked for UUID shape before anything is asked of the database. A path segment is
 * caller-controlled text, and it is interpolated into a PostgREST filter.
 *
 * The photograph is served through the image route rather than a signed URL, so `img-src` stays
 * `'self'`. The run panel is the only client component; everything else renders on the server.
 */
const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProjectPageProps {
  params: Promise<{ locale: string; id: string }>;
}

const ProjectPage = async ({ params }: ProjectPageProps) => {
  const { locale, id } = await params;

  if (!PROJECT_ID_PATTERN.test(id)) {
    notFound();
  }

  const token = await peekAccessToken();
  if (token.state === 'none' || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    notFound();
  }

  const tp = await getTranslations('project');
  const learning = await getTranslations('learning');

  if (token.state === 'expired') {
    return (
      <div className="flex flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{tp('title')}</h1>
        <p role="alert" className="text-sm">
          {tp('sessionExpired')}
        </p>
        <form action={logout.bind(null, locale)}>
          <button type="submit" className="text-sm underline underline-offset-4">
            {tp('signInAgain')}
          </button>
        </form>
      </div>
    );
  }

  const read = await readProject({
    supabaseUrl: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    accessToken: token.accessToken,
    projectId: id,
  });
  if (!read.ok && read.reason === 'not-found') {
    notFound();
  }

  if (!read.ok) {
    return (
      <div className="flex flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{tp('title')}</h1>
        <p role="alert" className="text-sm">
          {tp('unavailable')}
        </p>
      </div>
    );
  }

  const { project } = read;

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{tp('title')}</h1>
        <p className="text-sm text-muted-foreground">{tp('planPending')}</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <figure className="flex flex-col gap-2">
          {project.original ? (
            // A plain <img>: the bytes come from the app's own image route, already private and
            // cached, and `next/image` would add a second, public cache in front of them.
            // oxlint-disable-next-line nextjs/no-img-element
            <img
              src={`/api/images/${project.original.storageKey}`}
              alt={tp('photoAlt')}
              width={project.original.widthPx}
              height={project.original.heightPx}
              className="h-auto w-full rounded-md border"
            />
          ) : (
            <p className="text-sm text-muted-foreground">{tp('noOriginal')}</p>
          )}
          <figcaption className="text-xs text-muted-foreground">
            {tp('referenceLabel')}: <span className="font-mono">{project.projectId}</span>
          </figcaption>
        </figure>

        <RunPanel projectId={project.projectId} initialRunId={project.latestRun?.runId ?? null} />
      </div>

      <Link href="/learn" className="inline-flex min-h-11 items-center underline">
        {learning('link')}
      </Link>
      <div>
        <Link className="text-sm underline underline-offset-4" href="/projects/new">
          {tp('startAnother')}
        </Link>
      </div>
    </div>
  );
};

export default ProjectPage;
