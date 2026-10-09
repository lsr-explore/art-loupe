import type { CostWindow } from '@artloupe/schemas/ops-cost';
import type { RunHealthReport } from '@artloupe/schemas/ops-runs';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { CostAmount } from '@/components/costs/cost-amount';
import { OpsStateMessage } from '@/components/ops-state-message';
import { RunLink } from '@/components/runs/run-health-panel';
import { RunStatusLabel } from '@/components/runs/run-status';
import { useDuration } from '@/components/runs/use-duration';
import { Link } from '@/i18n/navigation';
import type { CostReportResult } from '@/lib/costs/fetch-cost-report';
import type { OpsResult } from '@/lib/ops-api';

const Metric = ({ label, value, hint }: { label: string; value: ReactNode; hint: string }) => (
  <div className="rounded-lg border bg-card p-5">
    <dt className="text-sm text-muted-foreground">{label}</dt>
    <dd className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</dd>
    <dd className="mt-2 text-xs text-muted-foreground">{hint}</dd>
  </div>
);

export const OverviewPanel = ({
  costs,
  runs,
  window,
}: {
  costs: CostReportResult;
  runs: OpsResult<RunHealthReport>;
  window: CostWindow;
}) => {
  const to = useTranslations('overview');
  const format = useFormatter();
  const duration = useDuration();
  const health = runs.status === 'ok' ? runs.data : null;
  const ledger = costs.status === 'ok' ? costs.data : null;
  const completed = health ? health.status_counts.succeeded + health.status_counts.failed : 0;
  const issues = health ? health.status_counts.failed + health.stalled_count : 0;
  const link = (view: 'runs' | 'costs', label: string) => (
    <Link
      href={{ pathname: '/home', query: { window, view } }}
      className="inline-flex min-h-10 items-center text-sm font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {label}{' '}
      <span aria-hidden="true" className="ml-2">
        →
      </span>
    </Link>
  );

  return (
    <section aria-labelledby="overview-heading" className="flex flex-col gap-6">
      <div>
        <h2 id="overview-heading" className="text-xl font-semibold">
          {to('title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{to('description')}</p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label={to('monitoredRuns')}
          value={health ? format.number(health.run_count) : '—'}
          hint={to('monitoredHint')}
        />
        <Metric
          label={to('successRate')}
          value={
            completed && health
              ? format.number(health.status_counts.succeeded / completed, {
                  style: 'percent',
                  maximumFractionDigits: 1,
                })
              : '—'
          }
          hint={to('successHint')}
        />
        <Metric
          label={to('runtime')}
          value={health?.run_time.p50_ms != null ? duration(health.run_time.p50_ms) : '—'}
          hint={to('runtimeHint')}
        />
        <Metric
          label={to('spend')}
          value={ledger ? <CostAmount totals={ledger.totals} /> : '—'}
          hint={to('spendHint')}
        />
      </dl>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="attention-heading" className="rounded-lg border bg-card p-5">
          <h3 id="attention-heading" className="font-semibold">
            {to('attention')}
          </h3>
          {runs.status !== 'ok' ? (
            <div className="mt-4">
              <OpsStateMessage status={runs.status} />
            </div>
          ) : (
            <>
              <p className="mt-3 text-sm font-medium">
                {to(issues > 0 ? 'issues' : health?.run_count ? 'clear' : 'noRuns')}
              </p>
              <dl className="mt-4 space-y-3 text-sm">
                {[
                  [to('failed'), health?.status_counts.failed ?? 0],
                  [to('stalled'), health?.stalled_count ?? 0],
                  [
                    to('inProgress'),
                    (health?.status_counts.queued ?? 0) + (health?.status_counts.running ?? 0),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium tabular-nums">{format.number(Number(value))}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">{to('stalledHint')}</p>
            </>
          )}
          <div className="mt-4 border-t pt-2">{link('runs', to('viewRuns'))}</div>
        </section>
        <section aria-labelledby="cost-summary-heading" className="rounded-lg border bg-card p-5">
          <h3 id="cost-summary-heading" className="font-semibold">
            {to('costSummary')}
          </h3>
          {costs.status !== 'ok' ? (
            <div className="mt-4">
              <OpsStateMessage status={costs.status} />
            </div>
          ) : ledger ? (
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{to('ledgerRuns')}</dt>
                <dd>{format.number(ledger.run_count)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{to('tokens')}</dt>
                <dd>{format.number(ledger.totals.input_tokens + ledger.totals.output_tokens)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{to('unpriced')}</dt>
                <dd>{format.number(ledger.totals.unpriced_rows)}</dd>
              </div>
              <div>
                <dt className="sr-only">{to('coverage')}</dt>
                <dd className="text-xs text-muted-foreground">
                  {to(ledger.totals.unpriced_rows > 0 ? 'partialPricing' : 'priced')}
                </dd>
              </div>
            </dl>
          ) : null}
          <div className="mt-4 border-t pt-2">{link('costs', to('viewCosts'))}</div>
        </section>
      </div>
      {health && health.recent_runs.length > 0 ? (
        <section aria-labelledby="activity-heading" className="rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="activity-heading" className="font-semibold">
              {to('recentActivity')}
            </h3>
            {link('runs', to('viewRuns'))}
          </div>
          <ul className="mt-2 divide-y">
            {health.recent_runs.slice(0, 3).map((run) => (
              <li
                key={run.run_id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="flex flex-wrap items-center gap-4">
                  <RunLink runId={run.run_id} />
                  <RunStatusLabel status={run.status} stalled={run.stalled} />
                </div>
                <time dateTime={run.created_at} className="text-xs text-muted-foreground">
                  {format.dateTime(new Date(run.created_at), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'UTC',
                  })}{' '}
                  UTC
                </time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
};
