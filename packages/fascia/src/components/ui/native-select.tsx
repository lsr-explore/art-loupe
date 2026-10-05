import { cn } from '@artloupe/fascia/lib/utils';
import type { ComponentProps } from 'react';

/** Native keyboard/touch behavior for compact forms without a custom popup. */
export const NativeSelect = ({ className, ...props }: ComponentProps<'select'>) => (
  <select
    className={cn(
      'min-h-11 w-full min-w-0 rounded-lg border border-foreground bg-background px-3 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50',
      className,
    )}
    {...props}
  />
);
