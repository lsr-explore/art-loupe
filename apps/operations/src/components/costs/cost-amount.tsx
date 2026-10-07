import type { CostTotals } from '@artloupe/schemas/ops-cost';
import { CircleHelp } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { costFigure } from '@/lib/costs/cost-figure';

type CostAmountProps = {
  totals: Pick<CostTotals, 'priced_cost_usd' | 'unpriced_rows' | 'node_executions'>;
};

/**
 * The unpriced marker. Its meaning is carried by its words, so it reads the same without
 * color. The dashed outline and the icon repeat that meaning visually and are not the signal.
 */
const UnpricedTag = ({ label }: { label: string }) => (
  <span
    data-cost="unpriced"
    className="inline-flex items-center gap-1 rounded-sm border border-dashed border-muted-foreground px-1.5 text-muted-foreground italic"
  >
    <CircleHelp aria-hidden="true" className="size-3.5 shrink-0" />
    {label}
  </span>
);

/**
 * A cost as it may honestly be stated. A real zero renders as "$0.00". An unknown cost renders
 * as the word "Unpriced", and a sum that leaves unpriced rows out reads "at least …".
 */
export const CostAmount = ({ totals }: CostAmountProps) => {
  const ta = useTranslations('costs.amount');
  const format = useFormatter();
  const figure = costFigure(totals);
  const usd = (value: number) =>
    format.number(value, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });

  if (figure.kind === 'priced')
    return (
      <span data-cost="priced" className="tabular-nums">
        {usd(figure.usd)}
      </span>
    );
  if (figure.kind === 'unpriced') return <UnpricedTag label={ta('unpriced')} />;
  return (
    <span data-cost="partial" className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="tabular-nums">{ta('atLeast', { amount: usd(figure.usd) })}</span>
      <UnpricedTag label={ta('unpricedCount', { count: figure.unpricedRows })} />
    </span>
  );
};
