import { cn } from '../../lib/utils';

interface DemoBannerProps {
  /** Single-line disclaimer, already translated by the consuming app. */
  message: string;
  className?: string;
}

/**
 * Permanent synthetic-data disclaimer, rendered above the header on every page of
 * every surface.
 *
 * `role="note"`, never `role="alert"`: an alert that can neither be dismissed nor
 * ever change trains people to filter alerts out — the opposite of what a system
 * whose safety surfaces rely on alerts can afford. It also carries no link; the
 * acknowledgement gate on the entry point is where the detail lives.
 */
export const DemoBanner = ({ message, className }: DemoBannerProps) => (
  <div
    role="note"
    className={cn(
      'border-primary/20 border-b bg-primary px-4 py-1.5 text-center text-primary-foreground text-xs',
      className,
    )}
  >
    {message}
  </div>
);
