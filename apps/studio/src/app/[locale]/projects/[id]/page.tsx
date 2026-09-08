import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * Where a completed upload lands — a placeholder, and it says so.
 *
 * The intake form navigates here on a 201 because the URL shape is worth establishing now: a
 * project is a thing with an address, and every later PR in the slice (the plates, the routing
 * summary, the geometry overlays, the interrupt) hangs off this route. What is *not* here is
 * any of that, and the page states the gap rather than dressing an empty shell as a result.
 *
 * **It reads nothing.** There is no GET for a project yet, so this page cannot confirm that the
 * id exists or that this artist owns it — and it must not pretend otherwise. It therefore says
 * the upload was received (which the redirect from the form is evidence of) and never that the
 * project was loaded. When the read path lands, ownership is answered by RLS and a missing or
 * foreign project becomes the same 404 the rest of the app already returns.
 *
 * The id is checked for UUID shape before it is rendered. React escapes interpolated text, so
 * this is not an injection guard; it is a correctness one — a path segment is caller-controlled
 * text, and echoing arbitrary text back as "your project" is a claim the page cannot support.
 */
const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProjectPageProps {
  params: Promise<{ id: string }>;
}

const ProjectPage = async ({ params }: ProjectPageProps) => {
  const { id } = await params;

  if (!PROJECT_ID_PATTERN.test(id)) {
    notFound();
  }

  const tp = await getTranslations('project');

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{tp('receivedTitle')}</h1>
        <p className="text-sm text-muted-foreground">{tp('receivedDescription')}</p>
      </div>
      <dl className="flex flex-col gap-1 text-sm">
        <dt className="text-muted-foreground">{tp('referenceLabel')}</dt>
        <dd className="font-mono">{id}</dd>
      </dl>
      <p className="text-sm text-muted-foreground">{tp('planPending')}</p>
      <div>
        <Link className="text-sm underline underline-offset-4" href="/projects/new">
          {tp('startAnother')}
        </Link>
      </div>
    </div>
  );
};

export default ProjectPage;
