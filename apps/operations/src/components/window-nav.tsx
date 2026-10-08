import { COST_WINDOWS, type CostWindow } from '@artloupe/schemas/ops-cost';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

/** The time window both home panels report on. Plain links, so it needs no client script. */
export const WindowNav = ({ current }: { current: CostWindow }) => {
  const tw = useTranslations('window');
  return (
    <nav aria-label={tw('label')}>
      <ul className="flex flex-wrap gap-2">
        {COST_WINDOWS.map((option) => (
          <li key={option}>
            <Link
              href={{ pathname: '/home', query: { window: option } }}
              aria-current={option === current ? 'page' : undefined}
              className="inline-flex min-h-6 items-center rounded-md border px-3 py-1 text-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:border-foreground aria-[current=page]:font-semibold"
            >
              {tw(option)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};
