import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { OpsStateMessage } from '@/components/ops-state-message';
import { RunDetailView } from '@/components/runs/run-detail';
import { Link } from '@/i18n/navigation';
import { fetchRunDetail } from '@/lib/runs/fetch-runs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type RunPageProps = { params: Promise<{ locale: string; id: string }> };

/** One run's drill-down (FR-901). Reached from the run tables on the home page. */
const RunPage = async ({ params }: RunPageProps) => {
  const { id } = await params;
  const runId = id.toLowerCase();
  // An id that cannot be a run is answered here, without asking the agent.
  if (!UUID.test(runId)) notFound();
  const td = await getTranslations('runs.detail');
  const result = await fetchRunDetail(runId);
  if (result.status === 'not-found') notFound();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
      <Link
        href="/home"
        className="self-start text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {td('back')}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">
        {td('title', { id: runId.slice(0, 8) })}
      </h1>
      {result.status === 'ok' ? (
        <RunDetailView detail={result.data} />
      ) : (
        <OpsStateMessage status={result.status} />
      )}
    </div>
  );
};

export default RunPage;
