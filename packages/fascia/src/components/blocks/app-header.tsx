import { BrandLogo } from './brand-logo';
import type { LinkComponent } from './link-component';
import { ThemeToggle } from './theme-toggle';

export interface AppHeaderLabels {
  /** Organisation wordmark beside the mark — "Art Loupe". */
  orgName: string;
  /**
   * Surface name after the separator. Omitted on the entry point, which *is* the
   * organisation's front door and has no app name to qualify it.
   */
  appName?: string;
  theme: { label: string; system: string; light: string; dark: string };
}

interface AppHeaderProps {
  labels: AppHeaderLabels;
  linkComponent: LinkComponent;
  /** Where the *app name* links — this surface's own home. Defaults to the surface root. */
  homeHref?: string;
  /**
   * Where the *organisation lockup* links — the entry point, which is how a visitor
   * crosses between surfaces. Cross-origin, so it renders as a plain `<a>`. Omitted on
   * the entry point itself, where the lockup falls back to `homeHref`.
   */
  orgHref?: string;
  /** Locale picker — app-supplied, because routing lives in the app. */
  languageControl: React.ReactNode;
  /** `<UserChip>` bound to the app's sign-out action; absent when signed out. */
  userControl?: React.ReactNode;
  /** Rendered first in the control row. The entry point puts its About link here. */
  leadingControl?: React.ReactNode;
  /**
   * Rendered above the control row but **inside** the `<header>` element.
   *
   * Inside, not as a sibling, because `role="note"` is not a landmark: a banner
   * floating between `<body>` and `<header>` leaves page content outside every
   * landmark, which axe flags as `region` and which makes the disclaimer
   * unreachable by landmark navigation. Visually it still sits above the header.
   */
  banner?: React.ReactNode;
}

/** Shared by both branches of the lockup so the two renderings cannot drift apart. */
const ORG_LOCKUP_CLASS =
  'flex shrink-0 items-center gap-2 rounded-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * Shared header for all four surfaces.
 *
 * Control order is fixed here rather than left to each app — `leadingControl`, then
 * theme, then language, then the user chip. Four surfaces
 * that each compose their own order is exactly the drift this component exists to
 * stop.
 *
 * The wordmark is HTML text beside the SVG mark, never baked into the asset:
 * it stays selectable, scales with the type, and needs no second file per theme.
 *
 * The identity chip is **two** destinations, not one. The organisation lockup goes to
 * the entry point — the only place that lists the surfaces, so it is the whole of this
 * demo's cross-app navigation — and the app name goes to that surface's own home. One
 * combined link had the org mark leading nowhere but the current app, which left no
 * route from one surface to another except editing the address bar.
 */
export const AppHeader = ({
  labels,
  linkComponent: Link,
  homeHref = '/',
  orgHref,
  languageControl,
  userControl,
  leadingControl,
  banner,
}: AppHeaderProps) => (
  <header className="border-b bg-background">
    {banner}
    {/* Wraps rather than locking to h-14: the identity chip pushes the control
        row past 320 CSS px, which would force two-dimensional scrolling
        (WCAG 2.2 AA, SC 1.4.10 Reflow).

        `print:hidden` on this row and not on the `<header>`, so that printing a
        page keeps the demonstration banner and drops only the controls. A theme
        toggle on paper is noise; a printed critique that reads as a real appraisal
        with no disclaimer on it is a genuine problem. */}
    <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 print:hidden">
      <div className="flex min-w-0 items-center gap-2.5">
        {/*
          A plain `<a>` when `orgHref` is set, because that href is a cross-origin
          absolute URL and the locale-aware `Link` is for in-app routes — the same
          split `<AppFooter>` already makes for its About links.
        */}
        {orgHref ? (
          <a href={orgHref} className={ORG_LOCKUP_CLASS}>
            <BrandLogo className="h-7" />
            <span>{labels.orgName}</span>
          </a>
        ) : (
          <Link href={homeHref} className={ORG_LOCKUP_CLASS}>
            <BrandLogo className="h-7" />
            <span>{labels.orgName}</span>
          </Link>
        )}
        {labels.appName ? (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              /
            </span>
            <Link
              href={homeHref}
              className="truncate rounded-sm text-muted-foreground text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:text-foreground"
            >
              {labels.appName}
            </Link>
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
        {leadingControl}
        <ThemeToggle
          label={labels.theme.label}
          optionLabels={{
            system: labels.theme.system,
            light: labels.theme.light,
            dark: labels.theme.dark,
          }}
        />
        {languageControl}
        {userControl}
      </div>
    </div>
  </header>
);
