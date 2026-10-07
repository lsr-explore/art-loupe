import type { RunStatus } from '@artloupe/schemas/ops-runs';
import { CircleCheck, CircleDashed, CircleX, Hourglass, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

const ICONS = {
  queued: CircleDashed,
  running: Hourglass,
  succeeded: CircleCheck,
  failed: CircleX,
} as const;

/**
 * A run's status as a word. The icon repeats the word and is hidden from assistive technology,
 * so no status depends on color or shape alone. A stalled run carries a second, labelled tag.
 */
export const RunStatusLabel = ({ status, stalled }: { status: RunStatus; stalled: boolean }) => {
  const tr = useTranslations('runs');
  const Icon = ICONS[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span data-run-status={status} className="inline-flex items-center gap-1">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {tr(`status.${status}`)}
      </span>
      {stalled ? (
        <span
          data-run-stalled
          className="inline-flex items-center gap-1 rounded-sm border border-dashed border-foreground px-1.5 font-semibold"
        >
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {tr('stalledTag')}
        </span>
      ) : null}
    </span>
  );
};

/** A failure reason in operator wording, or the raw code when it is not a known one. */
export const useReasonLabel = () => {
  const tr = useTranslations('runs');
  return (reason: string | null): string | null => {
    if (reason === null) return null;
    const key = `reasons.${reason}`;
    return tr.has(key) ? tr(key) : reason;
  };
};
