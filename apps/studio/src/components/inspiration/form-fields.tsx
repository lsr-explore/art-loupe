import { Input } from '@artloupe/fascia/components/ui/input';
import { Label } from '@artloupe/fascia/components/ui/label';
import type { ComponentProps, ReactNode } from 'react';

export const linkClass =
  'inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground';

export const Field = ({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) => (
  <div className="min-w-0 space-y-2">
    <Label htmlFor={id}>{label}</Label>
    {children}
  </div>
);

export const TextInput = (props: ComponentProps<typeof Input>) => (
  <Input
    className="min-h-11 border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
    {...props}
  />
);
