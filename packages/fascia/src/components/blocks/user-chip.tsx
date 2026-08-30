import { Button } from '@artloupe/fascia/components/ui/button';
import { cn } from '@artloupe/fascia/lib/utils';
import { UserRound } from 'lucide-react';
import type { ComponentProps } from 'react';

interface UserChipProps {
  /** Display name for the signed-in principal — an email on the companion, a username elsewhere. */
  username: string;
  /** Screen-reader-only prefix read before the username, e.g. "Signed in as". */
  signedInAsLabel: string;
  /** Visible label on the sign-out button. */
  signOutLabel: string;
  /** Sign-out action — a server action supplied by the consuming app, already bound to its locale. */
  signOutAction: ComponentProps<'form'>['action'];
  className?: string;
}

/**
 * Signed-in identity plus sign-out, shared by all three apps.
 *
 * Presentation-only: the caller reads the session and supplies the bound action,
 * so `@artloupe/fascia` keeps no dependency on `@artloupe/auth`. Deliberately not a
 * client component — a plain form posting to a server action needs no client JS,
 * so sign-out keeps working before hydration.
 */
export const UserChip = ({
  username,
  signedInAsLabel,
  signOutLabel,
  signOutAction,
  className,
}: UserChipProps) => (
  <div className={cn('flex min-w-0 items-center gap-2 sm:gap-3', className)}>
    <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      <UserRound aria-hidden="true" className="size-4 shrink-0" />
      <span className="sr-only">{signedInAsLabel}</span>
      <span className="max-w-36 truncate sm:max-w-48">{username}</span>
    </span>
    <form action={signOutAction}>
      <Button type="submit" variant="outline" size="sm">
        {signOutLabel}
      </Button>
    </form>
  </div>
);
