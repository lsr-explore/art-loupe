'use client';

import { Globe } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface LocaleOption {
  value: string;
  /** The language's own name for itself — "English", "Español". */
  label: string;
}

interface LanguageSelectProps {
  /** Currently active locale; must match one of `locales`. */
  locale: string;
  /** Accessible name for the control, e.g. "Language". */
  label: string;
  locales: LocaleOption[];
  /** Called with the chosen locale. The app routes; `fascia` does not. */
  onSelect: (locale: string) => void;
  className?: string;
}

/**
 * Locale picker for the shared header.
 *
 * Autonyms, not abbreviations and not flags: a flag
 * denotes a country rather than a language, and "ES" read aloud is ambiguous between
 * Spanish, Estonian and Spain. The full word needs no `aria-label` workaround.
 *
 * Presentational — routing lives in the app, because the locale-aware router comes
 * from each app's own `@/i18n/navigation`.
 */
export const LanguageSelect = ({
  locale,
  label,
  locales,
  onSelect,
  className,
}: LanguageSelectProps) => (
  <div className={cn('flex items-center gap-1.5', className)}>
    <Globe className="size-4 text-muted-foreground" aria-hidden="true" />
    <select
      value={locale}
      onChange={(ev) => onSelect(ev.target.value)}
      aria-label={label}
      className="cursor-pointer appearance-none rounded-sm border-none bg-transparent text-muted-foreground text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {locales.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);
