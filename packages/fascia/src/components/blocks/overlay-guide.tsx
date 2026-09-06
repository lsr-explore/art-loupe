'use client';

import { cn } from '@artloupe/fascia/lib/utils';
import type { OverlayPoint, OverlayStatus } from './overlay-geometry';

interface OverlayGuideProps {
  /** Ends of the line, in normalized coordinates. */
  from: OverlayPoint;
  to: OverlayPoint;
  status: OverlayStatus;
  /**
   * Describes the line for assistive technology — "Horizon line, confirmed". Optional: a guide
   * whose ends are themselves {@link OverlayHandle}s is already described by them, and naming
   * the line as well makes a screen reader read the same fact three times.
   */
  label?: string;
  className?: string;
}

const STATUS_STROKE: Record<OverlayStatus, string> = {
  proposed: 'stroke-amber-500',
  confirmed: 'stroke-emerald-600',
  adjusted: 'stroke-sky-600',
};

/**
 * A straight guide between two points — a horizon, a perspective ray, a proportion division.
 *
 * **Why SVG with `viewBox="0 0 1 1"` and `preserveAspectRatio="none"`.** It makes the
 * normalized coordinate space literal: a point at `{ x: 0.5, y: 0.5 }` is written as `0.5`,
 * with no conversion between the value the detector produced and the value drawn. The line's
 * width is then in the same stretched units, which is why it is restored with
 * `vector-effect="non-scaling-stroke"` — without it, a wide, short image would render the
 * horizon as a thick smear and a vertical guide as a hairline.
 *
 * **Why it is not interactive.** Dragging a *line* has no non-dragging equivalent that is not
 * simply "move its ends", and SC 2.5.7 would require inventing one. The ends are
 * {@link OverlayHandle}s, which already carry all three input paths, so the line follows them
 * and never needs its own.
 */
export const OverlayGuide = ({ from, to, status, label, className }: OverlayGuideProps) => (
  <svg
    aria-hidden={label === undefined || undefined}
    aria-label={label}
    className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
    data-slot="overlay-guide"
    data-status={status}
    preserveAspectRatio="none"
    role={label === undefined ? undefined : 'img'}
    viewBox="0 0 1 1"
  >
    <line
      className={cn(STATUS_STROKE[status])}
      strokeDasharray={status === 'proposed' ? '0.02 0.02' : undefined}
      strokeWidth={2}
      vectorEffect="non-scaling-stroke"
      x1={from.x}
      x2={to.x}
      y1={from.y}
      y2={to.y}
    />
  </svg>
);
