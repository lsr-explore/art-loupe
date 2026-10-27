import { peekAccessToken } from '@artloupe/auth/server';
import { getTranslations } from 'next-intl/server';

import { env } from '@/env';
import { Link } from '@/i18n/navigation';
import { readProjects, type ProjectLibrary } from '@/lib/projects/read-projects';

const HomePage = async ({
  searchParams,
  params,
}: { searchParams?: Promise<{ page?: string }>; params?: Promise<{ locale: string }> } = {}) => {
  const locale = (await params)?.locale ?? 'en';
  const requested = (await searchParams)?.page;
  const parsedPage = Number(requested ?? '1');
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;
  const token = await peekAccessToken();
  const library: ProjectLibrary =
    token.state === 'valid' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY
      ? await readProjects({
          supabaseUrl: env.SUPABASE_URL,
          anonKey: env.SUPABASE_ANON_KEY,
          accessToken: token.accessToken,
          page,
        })
      : { ok: false };
  const th = await getTranslations('home');
  const media = await getTranslations('intake.media');
  const learning = await getTranslations('learning');

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{th('title')}</h1>
        <p className="text-sm text-muted-foreground">{th('description')}</p>
      </div>
      <div className="flex flex-wrap gap-4">
        <Link
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          href="/projects/new"
        >
          {th('startProject')}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center rounded-lg border border-foreground px-4 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          href="/get-inspired"
        >
          {th('getInspired')}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center rounded-lg border border-foreground px-4 font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          href="/learn"
        >
          {learning('link')}
        </Link>
      </div>
      <section aria-labelledby="saved-projects-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="saved-projects-heading" className="text-xl font-semibold">
            {th('savedTitle')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{th('savedDescription')}</p>
        </div>
        {!library.ok ? (
          <p role="alert">{th('savedUnavailable')}</p>
        ) : library.projects.length === 0 ? (
          <p className="text-muted-foreground">{th(page > 1 ? 'noMoreProjects' : 'noProjects')}</p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {library.projects.map((project) => {
              const title =
                project.title?.trim() || project.source_images?.original_filename || th('untitled');
              return (
                <li key={project.id} className="min-w-0">
                  <Link
                    href={`/projects/${project.id}`}
                    className="flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {project.source_images ? (
                      // Private reference bytes bypass the shared Next image optimizer cache.
                      // oxlint-disable-next-line nextjs/no-img-element
                      <img
                        src={`/api/images/${project.source_images.storage_key}`}
                        alt=""
                        loading="lazy"
                        className="aspect-[4/3] w-full bg-muted/30 object-contain"
                      />
                    ) : (
                      <div className="aspect-[4/3] bg-muted/30" />
                    )}
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <h3 className="break-words font-semibold">{title}</h3>
                      {project.intent ? (
                        <p className="text-sm text-muted-foreground">
                          {media.has(project.intent.medium)
                            ? media(project.intent.medium)
                            : project.intent.medium}{' '}
                          · {th('minutes', { minutes: project.intent.time_budget_minutes })}
                        </p>
                      ) : null}
                      <p className="text-sm text-muted-foreground">
                        <time dateTime={project.created_at}>
                          {th('created', {
                            date: new Intl.DateTimeFormat(locale, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                              timeZone: 'UTC',
                            }).format(new Date(project.created_at)),
                          })}
                        </time>
                      </p>
                      <p className="text-sm">
                        {th(`status.${project.runs[0]?.status ?? 'notStarted'}`)}
                      </p>
                      <span className="mt-auto pt-2 text-sm underline">{th('openProject')}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <nav aria-label={th('pagination')} className="flex gap-6 text-sm">
          {page > 1 ? (
            <Link
              className="inline-flex min-h-11 items-center underline"
              href={`/home?page=${page - 1}`}
            >
              {th('previous')}
            </Link>
          ) : null}
          {library.ok && library.hasNext ? (
            <Link
              className="inline-flex min-h-11 items-center underline"
              href={`/home?page=${page + 1}`}
            >
              {th('next')}
            </Link>
          ) : null}
        </nav>
      </section>
    </div>
  );
};

export default HomePage;
