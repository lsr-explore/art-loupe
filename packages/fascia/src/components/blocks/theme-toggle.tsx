'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { cn } from '../../lib/utils';

type ThemeOption = 'system' | 'light' | 'dark';

interface ThemeToggleProps {
  /** Accessible name for the whole control, e.g. "Theme". */
  label: string;
  /** Visible-to-AT labels for each option. */
  optionLabels: Record<ThemeOption, string>;
  className?: string;
}

const options: { value: ThemeOption; Icon: typeof Monitor }[] = [
  { value: 'system', Icon: Monitor },
  { value: 'light', Icon: Sun },
  { value: 'dark', Icon: Moon },
];

/** No store to subscribe to — the value is constant per environment. */
const noopSubscribe = () => () => {};

/**
 * `false` during SSR and on the hydrating render, `true` afterwards.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: React's own hook
 * rules reject setting state synchronously inside an effect (it triggers a
 * cascading render), and this is the pattern the server/client snapshot pair
 * exists for.
 */
const useIsHydrated = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

/**
 * System / Light / Dark segmented control. Presentation-only reuse across all
 * three apps — each supplies translated labels; theme state comes from
 * next-themes.
 *
 * Nothing is marked active until mounted, and the `mounted` gate is load-bearing
 * rather than defensive: the server cannot know the resolved theme, so without it
 * `aria-pressed` and the active styling differ between the server HTML and the first
 * client render. React does NOT patch mismatched attributes — it warns and keeps the
 * server's — so the control would render with no option pressed and announce none
 * selected until something else forced a re-render. That is an accessibility defect,
 * not just a console warning.
 */
export const ThemeToggle = ({ label, optionLabels, className }: ThemeToggleProps) => {
  const { theme, setTheme } = useTheme();
  const mounted = useIsHydrated();

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5',
        className,
      )}
    >
      {options.map(({ value, Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={active}
            title={optionLabels[value]}
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors',
              'hover:text-foreground focus-visible:text-foreground',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              active && 'bg-primary text-primary-foreground hover:text-primary-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            <span className="sr-only">{optionLabels[value]}</span>
          </button>
        );
      })}
    </div>
  );
};
