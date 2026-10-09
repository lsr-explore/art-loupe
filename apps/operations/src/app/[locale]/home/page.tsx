import { COST_WINDOWS, type CostWindow } from '@artloupe/schemas/ops-cost';
import { getTranslations } from 'next-intl/server';

import { CostPanel } from '@/components/costs/cost-panel';
import { OverviewPanel } from '@/components/overview-panel';
import { RunHealthPanel } from '@/components/runs/run-health-panel';
import { ViewNav, type OperationsView } from '@/components/view-nav';
import { WindowNav } from '@/components/window-nav';
import { fetchCostReport } from '@/lib/costs/fetch-cost-report';
import { fetchRunHealth } from '@/lib/runs/fetch-runs';

const DEFAULT_WINDOW: CostWindow = '7d';

const isCostWindow = (value: unknown): value is CostWindow =>
  COST_WINDOWS.some((option) => option === value);

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const HomePage = async ({ searchParams }: HomePageProps) => {
  const th = await getTranslations('home');
  const search = await searchParams;
  const requested = search.window;
  const view: OperationsView =
    search.view === 'runs' || search.view === 'costs' ? search.view : 'overview';
  const costWindow = isCostWindow(requested) ? requested : DEFAULT_WINDOW;
  const [costs, runs] = await Promise.all([
    fetchCostReport(costWindow),
    fetchRunHealth(costWindow),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pt-10 pb-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{th('title')}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{th('description')}</p>
      </section>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <ViewNav current={view} window={costWindow} />
          <WindowNav current={costWindow} view={view} />
        </div>
        {view === 'overview' ? (
          <OverviewPanel costs={costs} runs={runs} window={costWindow} />
        ) : null}
        {view === 'costs' ? <CostPanel result={costs} /> : null}
        {view === 'runs' ? <RunHealthPanel result={runs} /> : null}
      </div>
    </div>
  );
};

export default HomePage;
