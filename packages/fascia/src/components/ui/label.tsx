'use client';

import { cn } from '@artloupe/fascia/lib/utils';
import type * as React from 'react';

const Label = ({ className, ...props }: React.ComponentProps<'label'>) => (
  // Primitive wrapper — the consumer supplies the association (`htmlFor` or nesting)
  // via spread props; it can't be declared here. jsx-a11y can't see that contract.
  // eslint-disable-next-line jsx-a11y/label-has-associated-control
  <label
    data-slot="label"
    className={cn(
      'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
      className,
    )}
    {...props}
  />
);

export { Label };
