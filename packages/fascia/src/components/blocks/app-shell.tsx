import { AppFooter, type AppFooterLabels } from './app-footer';
import { AppHeader, type AppHeaderLabels } from './app-header';
import { AppSidebar, type AppSidebarLabels } from './app-sidebar';
import { DemoBanner } from './demo-banner';
import type { LinkComponent } from './link-component';

export interface AppShellLabels extends AppHeaderLabels, AppSidebarLabels {
  /** Permanent synthetic-data disclaimer above the header. */
  banner: string;
  skipToContent: string;
  footer: AppFooterLabels;
}

interface AppShellProps {
  labels: AppShellLabels;
  /** Locale-aware `Link` from the app's `@/i18n/navigation`. */
  linkComponent: LinkComponent;
  homeHref?: string;
  orgHref?: string;
  languageControl: React.ReactNode;
  userControl?: React.ReactNode;
  leadingControl?: React.ReactNode;
  /**
   * Navigation rail. Omitted by operations, which has one route — a sidebar holding
   * a single item is furniture pretending to be navigation.
   */
  sidebar?: React.ReactNode;
  aboutBaseHref?: string;
  issuesHref?: string;
  children: React.ReactNode;
}

const MAIN_ID = 'main-content';

/**
 * The chrome every surface renders: disclaimer banner, header, optional sidebar,
 * main region, footer.
 *
 * It lives in `fascia` rather than being copy-pasted a fourth time. The dividing
 * line for what it owns: **anything `fascia` can render from strings alone** — the
 * logo, the theme toggle, the banner, the footer — and **slots for anything needing
 * app context** — the locale-aware `Link`, the locale router, the session-bound
 * sign-out. That is what lets `.dependency-cruiserrc.mjs`'s `no-fascia-to-app` rule
 * stay an error rather than a warning.
 *
 * Every string arrives as a prop; `fascia` never calls `useTranslations`. The
 * defaults for those strings ship from `packages/fascia/messages` and are merged
 * into each app's catalog by `withSharedMessages`, so "Sign out" is written once
 * rather than eight times.
 *
 * The skip link is not in the mockups. A shell with a sidebar puts a nav rail
 * between the header and the content on every page, which is precisely the case
 * WCAG 2.4.1 Bypass Blocks exists for.
 */
export const AppShell = ({
  labels,
  linkComponent,
  homeHref,
  orgHref,
  languageControl,
  userControl,
  leadingControl,
  sidebar,
  aboutBaseHref,
  issuesHref,
  children,
}: AppShellProps) => (
  <>
    <a
      href={`#${MAIN_ID}`}
      className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:font-medium focus:text-foreground focus:text-sm focus:outline-2 focus:outline-offset-2 focus:outline-ring"
    >
      {labels.skipToContent}
    </a>
    <AppHeader
      labels={labels}
      linkComponent={linkComponent}
      homeHref={homeHref}
      orgHref={orgHref}
      languageControl={languageControl}
      userControl={userControl}
      leadingControl={leadingControl}
      banner={<DemoBanner message={labels.banner} />}
    />
    <div className="flex flex-1 flex-col lg:flex-row">
      {sidebar ? <AppSidebar labels={labels}>{sidebar}</AppSidebar> : null}
      {/* `tabIndex={-1}` so the skip link moves focus, not just the viewport —
          without it the target is unfocusable and the next Tab resumes from the
          skip link, which is the bug that makes skip links look decorative. */}
      <main id={MAIN_ID} tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
        {children}
      </main>
    </div>
    <AppFooter labels={labels.footer} aboutBaseHref={aboutBaseHref} issuesHref={issuesHref} />
  </>
);
