'use client';

import { cn } from '@artloupe/fascia/lib/utils';
import { Separator as SeparatorPrimitive } from '@base-ui/react/separator';

const Separator = ({
  className,
  orientation = 'horizontal',
  ...props
}: SeparatorPrimitive.Props) => (
  <SeparatorPrimitive
    data-slot="separator"
    orientation={orientation}
    className={cn(
      'shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch',
      className,
    )}
    {...props}
  />
);

export { Separator };
