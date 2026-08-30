'use client';

import { Input } from '@artloupe/fascia/components/ui/input';
import { Label } from '@artloupe/fascia/components/ui/label';
import { cn } from '@artloupe/fascia/lib/utils';
import { Eye, EyeOff } from 'lucide-react';
import { type ReactNode, useState } from 'react';

interface PasswordFieldProps {
  /** Input id + submitted field name. */
  name: string;
  label: ReactNode;
  /** Accessible name for the reveal button while the password is hidden. */
  showLabel: string;
  /** Accessible name for the reveal button while the password is shown. */
  hideLabel: string;
  autoComplete?: string;
  required?: boolean;
}

/**
 * Password input with an accessible show/hide toggle. A client component because it
 * holds the reveal state. The toggle is a real `type="button"` so it never submits the
 * form; its accessible name flips between `showLabel` / `hideLabel` (the icon is
 * decorative), and `aria-controls` ties it to the input. Copy is passed in — fascia
 * carries no user-facing strings.
 */
export const PasswordField = ({
  name,
  label,
  showLabel,
  hideLabel,
  autoComplete = 'current-password',
  required = false,
}: PasswordFieldProps) => {
  const [visible, setVisible] = useState(false);
  const RevealIcon = visible ? EyeOff : Eye;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <div className="relative">
        <Input
          id={name}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((shown) => !shown)}
          aria-label={visible ? hideLabel : showLabel}
          aria-controls={name}
          className={cn(
            'absolute inset-y-0 right-0 flex items-center rounded-md px-3',
            'text-muted-foreground transition-colors hover:text-foreground',
            'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          )}
        >
          <RevealIcon className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
