import { cn } from '@artloupe/fascia/lib/utils';
import { ChevronDown } from 'lucide-react';
import type * as React from 'react';

/**
 * A native `<select>`, styled to sit beside `Input` and `Textarea`.
 *
 * Native rather than a listbox built from `div`s, and the reason is not simplicity. A custom
 * select has to reimplement typeahead, the closed-state arrow keys, the platform's own
 * scrolling popup, and — on a phone — the wheel picker the OS puts up. Every one of those is
 * behaviour a person already knows, and the WCAG 2.2 target-size and focus-appearance criteria
 * come satisfied by the platform rather than by us asserting they are.
 *
 * The tradeoff is real and is accepted: option rows cannot be styled, so a select with icons or
 * two-line entries needs `@base-ui/react`'s `Select` instead. Nothing in the app needs that yet,
 * and the day one does, it belongs beside this rather than replacing it.
 *
 * The chevron is `aria-hidden` decoration layered over the control with
 * `appearance-none` — the control keeps its own accessible name from a `<label htmlFor>`,
 * exactly as `Input` does. `pointer-events-none` on the wrapper's icon keeps the click
 * target the select itself.
 */
const Select = ({ className, children, ...props }: React.ComponentProps<'select'>) => (
  <div className="relative w-full">
    <select
      data-slot="select"
      className={cn(
        'h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
    />
  </div>
);

export { Select };
