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
import type { CostReport } from '@artloupe/schemas/ops-cost';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { OpsStateMessage } from '@/components/ops-state-message';
import type { CostReportResult } from '@/lib/costs/fetch-cost-report';

import { CostAmount } from './cost-amount';

const NUMERIC = 'text-right tabular-nums';

const Stat = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <Card size="sm">
    <CardHeader>
      <CardTitle>
        <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
      </CardTitle>
    </CardHeader>
    <CardContent className="flex flex-col gap-1">
      <p className="text-2xl font-semibold">{children}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </CardContent>
  </Card>
);

const CostTables = ({ report }: { report: CostReport }) => {
  const tc = useTranslations('costs');
  const format = useFormatter();
  const num = (value: number) => format.number(value);
  const seconds = (ms: number) =>
    tc('seconds', { value: format.number(ms / 1000, { maximumFractionDigits: 1 }) });

  return (
    <div className="flex flex-col gap-8">
      <Table regionLabelledBy="costs-by-model">
        <TableCaption id="costs-by-model">{tc('tables.byModel')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{tc('columns.model')}</TableHead>
            <TableHead className={NUMERIC}>{tc('columns.executions')}</TableHead>
            <TableHead className={NUMERIC}>{tc('columns.inputTokens')}</TableHead>
            <TableHead className={NUMERIC}>{tc('columns.outputTokens')}</TableHead>
            <TableHead className={NUMERIC}>{tc('columns.cacheRead')}</TableHead>
            <TableHead className={NUMERIC}>{tc('columns.cacheWrite')}</TableHead>
            <TableHead className="text-right">{tc('columns.cost')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.by_model.map((row) => (
            <TableRow key={row.model ?? '∅'}>
              <TableHead scope="row" className="font-mono text-xs">
                {row.model ?? <span className="font-sans">{tc('tables.deterministic')}</span>}
              </TableHead>
              <TableCell className={NUMERIC}>{num(row.node_executions)}</TableCell>
              <TableCell className={NUMERIC}>{num(row.input_tokens)}</TableCell>
              <TableCell className={NUMERIC}>{num(row.output_tokens)}</TableCell>
              <TableCell className={NUMERIC}>{num(row.cache_read_tokens)}</TableCell>
              <TableCell className={NUMERIC}>{num(row.cache_write_tokens)}</TableCell>
              <TableCell className="text-right">
                <CostAmount totals={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Table regionLabelledBy="costs-by-node">
        <TableCaption id="costs-by-node">{tc('tables.byNode')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{tc('columns.node')}</TableHead>
            <TableHead className={NUMERIC}>{tc('columns.executions')}</TableHead>
            <TableHead className={NUMERIC}>{tc('columns.reexecutions')}</TableHead>
            <TableHead className={NUMERIC}>{tc('columns.time')}</TableHead>
            <TableHead className="text-right">{tc('columns.cost')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.by_node.map((row) => (
            <TableRow key={row.node}>
              <TableHead scope="row" className="font-mono text-xs">
                {row.node}
              </TableHead>
              <TableCell className={NUMERIC}>{num(row.node_executions)}</TableCell>
              <TableCell className={NUMERIC}>{num(row.reexecutions)}</TableCell>
              <TableCell className={NUMERIC}>{seconds(row.duration_ms)}</TableCell>
              <TableCell className="text-right">
                <CostAmount totals={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-2">
        <Table regionLabelledBy="costs-recent-runs">
          <TableCaption id="costs-recent-runs">{tc('tables.recentRuns')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{tc('columns.run')}</TableHead>
              <TableHead>{tc('columns.started')}</TableHead>
              <TableHead className={NUMERIC}>{tc('columns.executions')}</TableHead>
              <TableHead className={NUMERIC}>{tc('columns.reexecutions')}</TableHead>
              <TableHead className={NUMERIC}>{tc('columns.inputTokens')}</TableHead>
              <TableHead className={NUMERIC}>{tc('columns.outputTokens')}</TableHead>
              <TableHead className="text-right">{tc('columns.cost')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.recent_runs.map((row) => (
              <TableRow key={row.run_id}>
                <TableHead scope="row" className="font-mono text-xs">
                  {row.run_id}
                </TableHead>
                <TableCell className="whitespace-nowrap">
                  {format.dateTime(new Date(row.started_at), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'UTC',
                  })}
                </TableCell>
                <TableCell className={NUMERIC}>{num(row.node_executions)}</TableCell>
                <TableCell className={NUMERIC}>{num(row.reexecutions)}</TableCell>
                <TableCell className={NUMERIC}>{num(row.input_tokens)}</TableCell>
                <TableCell className={NUMERIC}>{num(row.output_tokens)}</TableCell>
                <TableCell className="text-right">
                  <CostAmount totals={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {report.run_count > report.recent_runs.length ? (
          <p className="text-sm text-muted-foreground">
            {tc('tables.truncated', {
              shown: report.recent_runs.length,
              total: report.run_count,
            })}
          </p>
        ) : null}
      </div>
    </div>
  );
};

type CostPanelProps = { result: CostReportResult };

/** The operations cost panel: totals, then spend by model, by node and by recent run. */
export const CostPanel = ({ result }: CostPanelProps) => {
  const tc = useTranslations('costs');
  const format = useFormatter();

  return (
    <section aria-labelledby="costs-heading" className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h2 id="costs-heading" className="text-2xl font-semibold tracking-tight">
          {tc('title')}
        </h2>
        <p className="text-muted-foreground">{tc('description')}</p>
      </header>

      {result.status !== 'ok' ? (
        <OpsStateMessage status={result.status} />
      ) : result.data.totals.node_executions === 0 ? (
        <p className="rounded-md border p-4 text-sm">{tc('empty')}</p>
      ) : (
        <>
          <section aria-label={tc('stats.label')}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={tc('stats.spend')}>
                <CostAmount totals={result.data.totals} />
              </Stat>
              <Stat label={tc('stats.runs')}>{format.number(result.data.run_count)}</Stat>
              <Stat label={tc('stats.tokens')}>
                {format.number(result.data.totals.input_tokens + result.data.totals.output_tokens)}
              </Stat>
              <Stat label={tc('stats.unpriced')} hint={tc('stats.unpricedHint')}>
                {format.number(result.data.totals.unpriced_rows)}
              </Stat>
            </div>
          </section>
          <CostTables report={result.data} />
        </>
      )}
    </section>
  );
};
