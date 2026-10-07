import { useTranslations } from 'next-intl';

import type { RunResult } from '@/lib/runs/run-contract';

/**
 * The Studio Director's routing decision, as beat 4 of the walkthrough shows it: what runs, what
 * was declined and why, and the rationale (FR-307).
 *
 * A declination is rendered with its reason, never swallowed. The reasons and the rationale are
 * the Director's own words, in English; the page says so rather than presenting them as
 * translated copy.
 */
interface RoutingSummaryProps {
  routing: RunResult['routing'];
}

export const RoutingSummary = ({ routing }: RoutingSummaryProps) => {
  const tr = useTranslations('project.routing');
  const tt = useTranslations('project.tools');
  const toolName = (tool: string) => (tt.has(tool) ? tt(tool) : tool);

  return (
    <section aria-labelledby="routing-heading" className="flex flex-col gap-4">
      <h2 id="routing-heading" className="text-lg font-semibold">
        {tr('title')}
      </h2>
      <p className="text-sm">{routing.rationale}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{tr('selected')}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {routing.manifest.selected.map((entry) => (
              <li key={entry.tool}>
                <span className="font-medium">{toolName(entry.tool)}</span>
                {entry.reason ? (
                  <span className="text-muted-foreground"> — {entry.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{tr('declined')}</h3>
          {routing.manifest.declined.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr('noneDeclined')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {routing.manifest.declined.map((entry) => (
                <li key={entry.tool}>
                  <span className="font-medium">{toolName(entry.tool)}</span>
                  <span className="text-muted-foreground"> — {entry.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{tr('directorsWords')}</p>
    </section>
  );
};
