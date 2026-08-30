import { PasswordField } from '@artloupe/fascia/components/blocks/password-field';
import { Button } from '@artloupe/fascia/components/ui/button';
import { Input } from '@artloupe/fascia/components/ui/input';
import { Label } from '@artloupe/fascia/components/ui/label';
import { cn } from '@artloupe/fascia/lib/utils';
import type { ComponentProps, ReactNode } from 'react';

interface LoginFormProps {
  /** Form action — a server action or handler supplied by the consuming app. */
  action: ComponentProps<'form'>['action'];
  usernameLabel: ReactNode;
  passwordLabel: ReactNode;
  submitLabel: ReactNode;
  /** Accessible names for the password reveal toggle (fascia holds no copy). */
  showPasswordLabel: string;
  hidePasswordLabel: string;
  /** Field names submitted in the FormData (default `username` / `password`). */
  usernameName?: string;
  passwordName?: string;
  /** Input type + autocomplete for the identifier field (default a text username). */
  usernameType?: ComponentProps<'input'>['type'];
  usernameAutoComplete?: ComponentProps<'input'>['autoComplete'];
  /** Disable submission (e.g. until consent is given). */
  disabled?: boolean;
  /** Error message rendered in an assertive live region (e.g. invalid credentials). */
  error?: ReactNode;
  className?: string;
}

/**
 * Presentational login form. Holds no auth logic, routing, or copy — the app
 * passes the `action`, the labels, and any `error`. Native inputs are labelled
 * with `htmlFor` for correct accessible names.
 */
const LoginForm = ({
  action,
  usernameLabel,
  passwordLabel,
  submitLabel,
  showPasswordLabel,
  hidePasswordLabel,
  usernameName = 'username',
  passwordName = 'password',
  usernameType = 'text',
  usernameAutoComplete = 'username',
  disabled = false,
  error,
  className,
}: LoginFormProps) => (
  <form action={action} className={cn('flex w-full max-w-sm flex-col gap-4 text-left', className)}>
    {error ? (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    ) : null}
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={usernameName}>{usernameLabel}</Label>
      <Input
        id={usernameName}
        name={usernameName}
        type={usernameType}
        autoComplete={usernameAutoComplete}
        required
      />
    </div>
    <PasswordField
      name={passwordName}
      label={passwordLabel}
      showLabel={showPasswordLabel}
      hideLabel={hidePasswordLabel}
      autoComplete="current-password"
      required
    />
    <Button type="submit" disabled={disabled}>
      {submitLabel}
    </Button>
  </form>
);

export { LoginForm };
