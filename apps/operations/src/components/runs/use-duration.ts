import { useFormatter, useTranslations } from 'next-intl';

/** Formats milliseconds as "6.5 s", or "3 min 20 s" from a minute up. */
export const useDuration = () => {
  const td = useTranslations('durations');
  const format = useFormatter();
  return (ms: number): string => {
    if (ms < 60_000)
      return td('seconds', { value: format.number(ms / 1000, { maximumFractionDigits: 1 }) });
    const totalSeconds = Math.round(ms / 1000);
    return td('minutes', {
      minutes: format.number(Math.floor(totalSeconds / 60)),
      seconds: format.number(totalSeconds % 60),
    });
  };
};

/** The span between two timestamps, or null while the second has not happened. */
export const spanMs = (from: string | null, to: string | null): number | null =>
  from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : null;
