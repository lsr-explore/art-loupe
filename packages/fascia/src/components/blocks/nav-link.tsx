import { cn } from '../../lib/utils';
import type { LinkComponent } from './link-component';

interface NavLinkProps {
  href: string;
  /** Locale-aware `Link` from the consuming app — see `LinkComponent`. */
  linkComponent: LinkComponent;
  /**
   * Whether this link addresses the current page. Resolved by the caller, because
   * the only way to know is `usePathname()` from the app's own navigation module.
   */
  isActive: boolean;
  /**
   * Which token family styles the link, not merely how it is laid out.
   *
   * `sidebar` draws from `--sidebar-*`, `inline` from the page's `--muted` family.
   * The split matters because the two are **not** interchangeable: `--sidebar-accent`
   * is deliberately tinted (operations light `oklch(92.8% 0.026 250deg)`) where
   * `--muted` is near-neutral (`oklch(93.2% 0.0057 210deg)`). Rendering a rail out of
   * the muted family is what left the four `--sidebar-*` contrast assertions with
   * no consumer.
   *
   * `inline` is not legacy — the studio app uses it for page-level section nav,
   * where a sidebar tint would be wrong.
   */
  variant?: 'inline' | 'sidebar';
  children: React.ReactNode;
}

const VARIANT_STYLES = {
  inline: {
    base: 'focus-visible:outline-ring',
    active: 'bg-muted text-foreground',
    idle: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
  },
  sidebar: {
    base: 'block focus-visible:outline-sidebar-ring',
    active: 'bg-sidebar-primary text-sidebar-primary-foreground',
    idle: 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
  },
} as const;

/**
 * A single navigation link, styled once for every surface.
 *
 * Presentational by design: it takes `isActive` rather than reading the pathname,
 * which keeps it out of the client bundle and keeps `fascia` free of any app's
 * routing config. Each app wraps it in a ~12-line client component that supplies
 * both (see `apps/*​/src/components/layout/nav-link.tsx`).
 */
export const NavLink = ({
  href,
  linkComponent: Link,
  isActive,
  variant = 'inline',
  children,
}: NavLinkProps) => {
  const styles = VARIANT_STYLES[variant];

  return (
    <Link
      href={href}
      className={cn(
        'rounded-md px-3 py-1.5 font-medium text-sm transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        styles.base,
        isActive ? styles.active : styles.idle,
      )}
      aria-current={isActive ? 'page' : undefined}
    >
      {children}
    </Link>
  );
};
