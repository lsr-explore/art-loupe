import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@artloupe/fascia/components/ui/table';
import type { RunDetail } from '@artloupe/schemas/ops-runs';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { CostAmount } from '@/components/costs/cost-amount';

import { RunStatusLabel, useReasonLabel } from './run-status';
import { spanMs, useDuration } from './use-duration';

const NUMERIC = 'text-right tabular-nums';

const Field = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
    <dt className="font-medium sm:w-56 sm:shrink-0">{term}</dt>
    <dd className="break-all">{children}</dd>
  </div>
);

/** One run, end to end: its summary, each node it ran, its raw event log, and its ledger. */
export const RunDetailView = ({ detail }: { detail: RunDetail }) => {
  const td = useTranslations('runs.detail');
  const format = useFormatter();
  const duration = useDuration();
  const reasonLabel = useReasonLabel();
  const { run } = detail;
  const when = (value: string | null) =>
    value === null
      ? td('fields.notYet')
      : format.dateTime(new Date(value), {
          dateStyle: 'medium',
          timeStyle: 'medium',
          timeZone: 'UTC',
        });
  const ran = spanMs(run.started_at, run.finished_at);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="run-summary" className="flex flex-col gap-3">
        <h2 id="run-summary" className="text-xl font-semibold">
          {td('summary')}
        </h2>
        <dl className="flex flex-col gap-2 text-sm">
          <Field term={td('fields.runId')}>
            <span className="font-mono">{run.run_id}</span>
          </Field>
          <Field term={td('fields.projectId')}>
            <span className="font-mono">{run.project_id}</span>
          </Field>
          <Field term={td('fields.status')}>
            <RunStatusLabel status={run.status} stalled={run.stalled} />
          </Field>
          {run.reason ? <Field term={td('fields.reason')}>{reasonLabel(run.reason)}</Field> : null}
          {detail.error_detail ? (
            <Field term={td('fields.errorDetail')}>{detail.error_detail}</Field>
          ) : null}
          <Field term={td('fields.created')}>{when(run.created_at)}</Field>
          <Field term={td('fields.started')}>{when(run.started_at)}</Field>
          <Field term={td('fields.finished')}>{when(run.finished_at)}</Field>
          <Field term={td('fields.duration')}>
            {ran === null ? td('fields.notYet') : duration(ran)}
          </Field>
          <Field term={td('fields.cost')}>
            {run.cost ? <CostAmount totals={run.cost} /> : td('fields.notYet')}
          </Field>
        </dl>
      </section>

      <Table regionLabelledBy="run-steps">
        <TableCaption id="run-steps">{td('steps')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{td('columns.node')}</TableHead>
            <TableHead className={NUMERIC}>{td('columns.startedAt')}</TableHead>
            <TableHead className={NUMERIC}>{td('columns.duration')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {detail.steps.map((step, index) => (
            <TableRow key={`${step.node}:${index}`}>
              <TableHead scope="row" className="font-mono text-xs">
                {step.node}
              </TableHead>
              <TableCell className={NUMERIC}>
                {step.started_at === null
                  ? td('notRecorded')
                  : duration(spanMs(run.created_at, step.started_at) ?? 0)}
              </TableCell>
              <TableCell className={NUMERIC}>
                {step.duration_ms !== null ? (
                  duration(step.duration_ms)
                ) : step.finished_at === null ? (
                  <span data-step="unfinished" className="font-semibold">
                    {td('didNotFinish')}
                  </span>
                ) : (
                  td('notRecorded')
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Table regionLabelledBy="run-events">
        <TableCaption id="run-events">{td('events')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className={NUMERIC}>{td('columns.seq')}</TableHead>
            <TableHead>{td('columns.event')}</TableHead>
            <TableHead>{td('columns.subject')}</TableHead>
            <TableHead className={NUMERIC}>{td('columns.at')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {detail.events.map((event) => (
            <TableRow key={event.seq}>
              <TableHead scope="row" className={NUMERIC}>
                {event.seq}
              </TableHead>
              <TableCell>{td(`eventKinds.${event.kind}`)}</TableCell>
              <TableCell className={event.node ? 'font-mono text-xs' : undefined}>
                {event.node ?? reasonLabel(event.reason)}
              </TableCell>
              <TableCell className={NUMERIC}>{duration(event.offset_ms)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {detail.ledger.length > 0 ? (
        <Table regionLabelledBy="run-ledger">
          <TableCaption id="run-ledger">{td('ledger')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{td('columns.node')}</TableHead>
              <TableHead className={NUMERIC}>{td('columns.duration')}</TableHead>
              <TableHead className="text-right">{td('fields.cost')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.ledger.map((row) => (
              <TableRow key={row.node}>
                <TableHead scope="row" className="font-mono text-xs">
                  {row.node}
                </TableHead>
                <TableCell className={NUMERIC}>{duration(row.duration_ms)}</TableCell>
                <TableCell className="text-right">
                  <CostAmount totals={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
};
