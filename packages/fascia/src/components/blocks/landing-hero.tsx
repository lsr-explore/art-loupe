import { cn } from '@artloupe/fascia/lib/utils';
import type { ReactNode } from 'react';

interface LandingHeroProps {
  /** Primary heading — rendered as the page `<h1>`. */
  title: ReactNode;
  /** Supporting copy beneath the heading. */
  description?: ReactNode;
  /** Small overline above the heading (e.g. the org brand). */
  eyebrow?: ReactNode;
  /** Call-to-action area below the copy (e.g. consent + login). */
  children?: ReactNode;
  className?: string;
}

/**
 * Presentational landing hero. All copy is passed in by the consumer — this
 * component holds no i18n strings, state, or routing.
 */
const LandingHero = ({ title, description, eyebrow, children, className }: LandingHeroProps) => (
  <section className={cn('flex flex-col items-center gap-6 px-4 py-16 text-center', className)}>
    <div className="flex flex-col items-center gap-4">
      {eyebrow ? (
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
      {description ? (
        <p className="max-w-2xl text-lg text-muted-foreground">{description}</p>
      ) : null}
    </div>
    {children}
  </section>
);

export { LandingHero };
