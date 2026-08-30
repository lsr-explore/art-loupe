import type { ComponentType, ReactNode } from 'react';

/**
 * The locale-aware `Link` each app exports from `@/i18n/navigation`.
 *
 * `fascia` cannot import it: that module is generated from an app's own `routing`
 * config, and `.dependency-cruiserrc.mjs` forbids `packages/fascia` → `apps/`
 * outright. So the shell takes the component as a prop — the same seam the other
 * `fascia` blocks use for translated `label` props.
 *
 * Deliberately narrow: `href` is a plain string rather than next-intl's `Href<…>`
 * union, because the shell only ever passes literal in-app paths and a structural
 * type keeps `fascia` free of a `next-intl` dependency.
 */
export type LinkComponent = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
  'aria-current'?: 'page';
}>;
