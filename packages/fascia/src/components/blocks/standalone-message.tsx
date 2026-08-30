import { BrandLogo } from './brand-logo';

export interface StandaloneMessageLabels {
  /** Organisation wordmark beside the mark — "Art Loupe". */
  orgName: string;
  /** Page `<h1>`. */
  title: string;
  /** Supporting copy beneath the heading. */
  message: string;
  /** Text of the single call to action. */
  actionLabel: string;
}

interface StandaloneMessageProps {
  labels: StandaloneMessageLabels;
  /** Where the call to action points — the entry point, usually cross-origin. */
  actionHref: string;
}

/**
 * The dead-end page: a full-page message rendered **outside** `<AppShell>`.
 *
 * It exists for the two boundaries Next renders without a layout — `global-not-found`
 * and `global-error` — where the surrounding chrome is exactly what is unavailable.
 * So this deliberately uses **no** provider-backed primitive: no `next-intl` hook (no
 * `NextIntlClientProvider` is mounted), no locale-aware `Link` (no router context),
 * no `Button` with `render={<Link/>}`. Every string arrives as a prop and the action
 * is a plain `<a>` to an absolute URL.
 *
 * The theme is whatever `globals.css` declares at `:root`, because `ThemeProvider` is
 * not mounted either and nothing writes the `.dark` class — a stranded page rendering
 * light in a dark-themed browser is the accepted cost of it rendering at all.
 */
export const StandaloneMessage = ({ labels, actionHref }: StandaloneMessageProps) => (
  <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-6 py-16 text-center text-foreground">
    <div className="flex flex-col items-center gap-3">
      <BrandLogo className="h-14" idPrefix="standalone" />
      <span className="font-semibold text-lg tracking-tight">{labels.orgName}</span>
    </div>

    <div className="flex max-w-prose flex-col gap-3">
      <h1 className="text-balance font-semibold text-2xl tracking-tight sm:text-3xl">
        {labels.title}
      </h1>
      <p className="text-pretty text-base text-muted-foreground leading-relaxed">
        {labels.message}
      </p>
    </div>

    <a
      href={actionHref}
      className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:bg-primary/90"
    >
      {labels.actionLabel}
    </a>
  </div>
);
