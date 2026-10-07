import { COST_WINDOWS, type CostWindow } from '@artloupe/schemas/ops-cost';
import { getTranslations } from 'next-intl/server';

import { CostPanel } from '@/components/costs/cost-panel';
import { fetchCostReport } from '@/lib/costs/fetch-cost-report';

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
  const result = await fetchCostReport(costWindow);

  return (
    <div className="flex flex-1 flex-col">
      <section className="flex flex-col items-center gap-4 border-b px-4 py-16 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          {th('title')}
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">{th('description')}</p>
      </section>
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <CostPanel costWindow={costWindow} result={result} />
      </div>
    </div>
  );
};

export default HomePage;
