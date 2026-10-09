import type { CostWindow } from '@artloupe/schemas/ops-cost';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

export type OperationsView = 'overview' | 'runs' | 'costs';

export const ViewNav = ({ current, window }: { current: OperationsView; window: CostWindow }) => {
  const to = useTranslations('overview');
  return (
    <nav aria-label={to('navigation')}>
      <ul className="flex flex-wrap gap-1">
        {(['overview', 'runs', 'costs'] as const).map((view) => (
          <li key={view}>
            <Link
              href={{ pathname: '/home', query: { window, view } }}
              aria-current={current === view ? 'page' : undefined}
              className="inline-flex min-h-10 items-center rounded-md px-4 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
            >
              {to(view)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};
