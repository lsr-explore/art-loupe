'use client';

import { Dialog } from '@base-ui/react/dialog';
import { Menu, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '../../lib/utils';

export interface AppSidebarLabels {
  /** Accessible name for the navigation landmark, e.g. "Sections". */
  sidebarLabel: string;
  openSidebar: string;
  closeSidebar: string;
}

interface AppSidebarProps {
  labels: AppSidebarLabels;
  /** Navigation content — links, groups, whatever the surface needs. */
  children: React.ReactNode;
}

const triggerClass =
  'inline-flex items-center gap-2 rounded-md border border-sidebar-border px-3 py-1.5 font-medium text-sidebar-foreground text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring';

/**
 * The shell's optional navigation rail: a persistent column from `lg` up, and a
 * focus-trapped overlay below it (spec note 14).
 *
 * The children render **twice** — once in the always-present `<aside>`, once inside
 * the popup. Two copies rather than one moved node because the desktop copy is
 * `display: none` below `lg`, which drops it from the accessibility tree entirely,
 * so nothing is announced or tab-reachable twice. The same trick `<BrandLogo />`
 * uses for its light and dark variants.
 *
 * The overlay is a real dialog, not a disclosure: a menu that covers the page has to
 * trap focus and close on Escape, and rebuilding that on a `<div>` is how those get
 * missed.
 */
export const AppSidebar = ({ labels, children }: AppSidebarProps) => {
  const [isOpen, setIsOpen] = useState(false);

  /**
   * Close the overlay when a link inside it is activated.
   *
   * An App Router layout survives client-side navigation without remounting, so
   * `isOpen` outlives the page it was opened on: tapping a link in the drawer
   * navigates underneath it and leaves the drawer covering the new page until it
   * is dismissed by hand.
   *
   * A `usePathname()` effect is the obvious fix and is what an app would do, but
   * `usePathname` lives in `next/navigation` and **`fascia` declares no `next`
   * dependency** — it is a React package whose only framework-adjacent import is
   * `next-themes`. Importing it would resolve only by hoisting; vitest proves the
   * point by failing outright on the specifier. Listening for the navigation
   * instead keeps the package framework-agnostic.
   *
   * A **callback ref** rather than an effect, because the listener's lifetime is
   * the popup node's: the popup only exists while open, so an effect would need
   * `isOpen` in its dependencies purely to re-run once the node exists — which
   * Biome correctly reads as an unnecessary dependency. React 19 lets a ref
   * callback return its own cleanup, which is exactly this shape.
   *
   * Delegated from the container rather than bound per link, because the nav
   * content is whatever the app passes as `children`; and via a native listener
   * rather than `onClick`, because a click handler on a non-interactive element
   * is a jsx-a11y violation — the container genuinely is not interactive, the
   * anchors inside it are.
   */
  const bindPopupNav = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      return;
    }

    const closeOnLinkActivation = (ev: MouseEvent) => {
      if ((ev.target as HTMLElement | null)?.closest('a')) {
        setIsOpen(false);
      }
    };

    node.addEventListener('click', closeOnLinkActivation);

    return () => node.removeEventListener('click', closeOnLinkActivation);
  }, []);

  /**
   * Back and Forward leave the page without any click landing inside the drawer.
   *
   * This is deliberately broader than history traversal. Measured under the App
   * Router, an in-page anchor click fires `popstate` *and* `hashchange` — not the
   * plain-HTML behaviour, where `popstate` is a traversal-only event — so a
   * same-page `#anchor` jump also dismisses the drawer.
   *
   * Harmless as the shell stands: the only anchors reachable while the drawer is
   * open are inside it, where the delegated handler above closes it anyway, and
   * dismissing on an in-page jump is what you want on a phone regardless — you
   * navigated to see the target. Worth knowing before a rail grows in-page anchor
   * nav, because that is when "the drawer closed and the page didn't
   * change" would start to look like a bug rather than the intent.
   */
  useEffect(() => {
    const close = () => setIsOpen(false);

    window.addEventListener('popstate', close);

    return () => window.removeEventListener('popstate', close);
  }, []);

  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      {/* Its own row above the content on narrow screens; the flex parent switches to
          a column below `lg`, so this stacks rather than sitting beside `<main>`.

          `print:hidden` is not redundant with `lg:hidden`: a printed page is about
          51rem wide, so the `lg` breakpoint never matches and the trigger would
          otherwise appear on paper as a dead "Menu" button. */}
      <div className="border-sidebar-border border-b bg-sidebar p-2 lg:hidden print:hidden">
        <Dialog.Trigger className={triggerClass}>
          <Menu aria-hidden="true" className="size-4" />
          {labels.openSidebar}
        </Dialog.Trigger>
      </div>

      <aside className="hidden w-56 shrink-0 border-sidebar-border border-r bg-sidebar lg:block print:hidden">
        <nav aria-label={labels.sidebarLabel} className="sticky top-0 flex flex-col gap-1 p-4">
          {children}
        </nav>
      </aside>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0" />
        <Dialog.Popup
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-1 overflow-y-auto bg-sidebar p-4 text-sidebar-foreground shadow-lg outline-none',
            'data-closed:animate-out data-closed:slide-out-to-left data-open:animate-in data-open:slide-in-from-left',
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <Dialog.Title className="font-medium text-sidebar-foreground text-sm">
              {labels.sidebarLabel}
            </Dialog.Title>
            <Dialog.Close
              aria-label={labels.closeSidebar}
              className="rounded-md p-1 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring"
            >
              <X aria-hidden="true" className="size-4" />
            </Dialog.Close>
          </div>
          {/* Not a <nav>: the popup is already named by its Dialog.Title, and a second
              navigation landmark with the same name reads as a duplicate to AT. */}
          <div ref={bindPopupNav} className="flex flex-col gap-1">
            {children}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
