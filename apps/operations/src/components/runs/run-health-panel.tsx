import { Card, CardContent, CardHeader, CardTitle } from '@artloupe/fascia/components/ui/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@artloupe/fascia/components/ui/table';
import type { RunHealthReport, RunSummary } from '@artloupe/schemas/ops-runs';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { CostAmount } from '@/components/costs/cost-amount';
import { OpsStateMessage } from '@/components/ops-state-message';
import { Link } from '@/i18n/navigation';
import type { OpsResult } from '@/lib/ops-api';

import { RunStatusLabel, useReasonLabel } from './run-status';
import { spanMs, useDuration } from './use-duration';

const NUMERIC = 'text-right tabular-nums';

const Stat = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <Card size="sm">
    <CardHeader>
      <CardTitle>
        <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
      </CardTitle>
    </CardHeader>
    <CardContent className="flex flex-col gap-1">
      <p className="text-2xl font-semibold tabular-nums">{children}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </CardContent>
  </Card>
);

/** The link to a run's drill-down, named by the short form of its id. */
export const RunLink = ({ runId }: { runId: string }) => {
  const tr = useTranslations('runs');
  return (
    <Link
      href={`/runs/${runId}`}
      className="font-mono text-xs underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {tr('runLink', { id: runId.slice(0, 8) })}
    </Link>
  );
};

const RunRows = ({ runs }: { runs: RunSummary[] }) => {
  const tr = useTranslations('runs');
  const format = useFormatter();
  const duration = useDuration();
  const reasonLabel = useReasonLabel();
  return runs.map((run) => {
    const ran = spanMs(run.started_at, run.finished_at);
    return (
      <TableRow key={run.run_id}>
        <TableHead scope="row">
          <RunLink runId={run.run_id} />
        </TableHead>
        <TableCell>
          <RunStatusLabel status={run.status} stalled={run.stalled} />
        </TableCell>
        <TableCell>{reasonLabel(run.reason)}</TableCell>
        <TableCell className="font-mono text-xs">{run.failed_node}</TableCell>
        <TableCell className="whitespace-nowrap">
          {format.dateTime(new Date(run.created_at), {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'UTC',
          })}
        </TableCell>
        <TableCell className={NUMERIC}>
          {ran === null ? tr('detail.fields.notYet') : duration(ran)}
        </TableCell>
        <TableCell className="text-right">
          {run.cost ? <CostAmount totals={run.cost} /> : tr('tables.noCost')}
        </TableCell>
      </TableRow>
    );
  });
};

const RunTable = ({ id, caption, runs }: { id: string; caption: string; runs: RunSummary[] }) => {
  const tr = useTranslations('runs');
  return (
    <Table regionLabelledBy={id}>
      <TableCaption id={id}>{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{tr('columns.run')}</TableHead>
          <TableHead>{tr('columns.status')}</TableHead>
          <TableHead>{tr('columns.reason')}</TableHead>
          <TableHead>{tr('columns.failedNode')}</TableHead>
          <TableHead>{tr('columns.created')}</TableHead>
          <TableHead className={NUMERIC}>{tr('columns.duration')}</TableHead>
          <TableHead className="text-right">{tr('columns.cost')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <RunRows runs={runs} />
      </TableBody>
    </Table>
  );
};

const Durations = ({ report }: { report: RunHealthReport }) => {
  const tr = useTranslations('runs');
  const duration = useDuration();
  const rows = [
    ['queueWait', report.queue_wait],
    ['runTime', report.run_time],
  ] as const;
  return (
    <Table regionLabelledBy="runs-durations">
      <TableCaption id="runs-durations">{tr('durations.label')}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>
            <span className="sr-only">{tr('durations.label')}</span>
          </TableHead>
          <TableHead className={NUMERIC}>{tr('durations.median')}</TableHead>
          <TableHead className={NUMERIC}>{tr('durations.p95')}</TableHead>
          <TableHead className={NUMERIC}>{tr('columns.runs')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([key, stats]) => (
          <TableRow key={key}>
            <TableHead scope="row">{tr(`durations.${key}`)}</TableHead>
            <TableCell className={NUMERIC}>
              {stats.p50_ms === null ? tr('durations.none') : duration(stats.p50_ms)}
            </TableCell>
            <TableCell className={NUMERIC}>
              {stats.p95_ms === null ? tr('durations.none') : duration(stats.p95_ms)}
            </TableCell>
            <TableCell className={NUMERIC}>{stats.runs}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const Failures = ({ report }: { report: RunHealthReport }) => {
  const tr = useTranslations('runs');
  const reasonLabel = useReasonLabel();
  return (
    <Table regionLabelledBy="runs-failures">
      <TableCaption id="runs-failures">{tr('tables.failures')}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{tr('columns.reason')}</TableHead>
          <TableHead>{tr('columns.failedNode')}</TableHead>
          <TableHead className={NUMERIC}>{tr('columns.runs')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.failures.map((group) => (
          <TableRow key={`${group.reason}:${group.failed_node ?? ''}`}>
            <TableHead scope="row">{reasonLabel(group.reason)}</TableHead>
            <TableCell className="font-mono text-xs">
              {group.failed_node ?? <span className="font-sans">{tr('tables.betweenNodes')}</span>}
            </TableCell>
            <TableCell className={NUMERIC}>{group.runs}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

/** FR-901: how runs ended, where failures stopped them, and which runs are stuck. */
export const RunHealthPanel = ({ result }: { result: OpsResult<RunHealthReport> }) => {
  const tr = useTranslations('runs');
  const format = useFormatter();
  const report = result.status === 'ok' ? result.data : null;

  return (
    <section aria-labelledby="runs-heading" className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h2 id="runs-heading" className="text-2xl font-semibold tracking-tight">
          {tr('title')}
        </h2>
        <p className="text-muted-foreground">
          {tr('description')}
          {report
            ? ` ${tr('stallRule', { minutes: format.number(report.stall_after_seconds / 60, { maximumFractionDigits: 0 }) })}`
            : null}
        </p>
      </header>

      {result.status !== 'ok' ? (
        <OpsStateMessage status={result.status} />
      ) : report && report.run_count === 0 && report.stalled.length === 0 ? (
        <p className="rounded-md border p-4 text-sm">{tr('empty')}</p>
      ) : report ? (
        <>
          <section aria-label={tr('stats.label')}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label={tr('stats.runs')}>{format.number(report.run_count)}</Stat>
              <Stat label={tr('stats.succeeded')}>
                {format.number(report.status_counts.succeeded)}
              </Stat>
              <Stat label={tr('stats.failed')}>{format.number(report.status_counts.failed)}</Stat>
              <Stat label={tr('stats.inProgress')}>
                {format.number(report.status_counts.queued + report.status_counts.running)}
              </Stat>
              <Stat label={tr('stats.stalled')} hint={tr('stats.stalledHint')}>
                {format.number(report.stalled.length)}
              </Stat>
            </div>
          </section>
          {report.stalled.length > 0 ? (
            <RunTable id="runs-stalled" caption={tr('tables.stalled')} runs={report.stalled} />
          ) : null}
          <Durations report={report} />
          {report.failures.length > 0 ? <Failures report={report} /> : null}
          <div className="flex flex-col gap-2">
            <RunTable
              id="runs-recent"
              caption={tr('tables.recentRuns')}
              runs={report.recent_runs}
            />
            {report.run_count > report.recent_runs.length ? (
              <p className="text-sm text-muted-foreground">
                {tr('tables.truncated', {
                  shown: report.recent_runs.length,
                  total: report.run_count,
                })}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
};
