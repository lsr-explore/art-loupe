import { COST_WINDOWS, type CostWindow } from '@artloupe/schemas/ops-cost';
import { getTranslations } from 'next-intl/server';

import { CostPanel } from '@/components/costs/cost-panel';
import { RunHealthPanel } from '@/components/runs/run-health-panel';
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
  const requested = (await searchParams).window;
  const costWindow = isCostWindow(requested) ? requested : DEFAULT_WINDOW;
  const [costs, runs] = await Promise.all([
    fetchCostReport(costWindow),
    fetchRunHealth(costWindow),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <section className="flex flex-col items-center gap-4 border-b px-4 py-16 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          {th('title')}
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">{th('description')}</p>
      </section>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-10">
        <WindowNav current={costWindow} />
        <CostPanel result={costs} />
        <RunHealthPanel result={runs} />
      </div>
    </div>
  );
};

export default HomePage;
