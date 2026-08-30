import { cn } from '../../lib/utils';

export interface AppFooterLabels {
  /** Accessible name for the links row, e.g. "Site information". */
  label: string;
  accessibility: string;
  privacy: string;
  reportIssue: string;
  /** Screen-reader-only suffix on the external link, e.g. "(opens in a new tab)". */
  opensInNewTab: string;
  /** Fully formatted copyright line — the app interpolates the year. */
  copyright: string;
}

interface AppFooterProps {
  labels: AppFooterLabels;
  /**
   * Origin of the surface hosting the About site. The three apps pass the
   * entry-point origin so all four footers point at **one** canonical copy rather
   * than four translated duplicates; the entry point itself
   * omits it and links same-origin.
   */
  aboutBaseHref?: string;
  /** Repository issues URL behind "Report an Issue". */
  issuesHref?: string;
  className?: string;
}

const GitHubIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
  </svg>
);

const linkClass =
  'rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * Shared footer: three links centered, copyright centered on its own line below.
 *
 * The About links are plain `<a>` rather than the shell's `linkComponent` on
 * purpose. They are cross-origin from three of the four surfaces, and the About
 * site is English-only, so routing them through a locale-aware `Link` would
 * produce `/es/about/…` URLs that do not exist.
 */
export const AppFooter = ({
  labels,
  aboutBaseHref = '',
  issuesHref = 'https://github.com/lsr-explore/art-loupe/issues',
  className,
}: AppFooterProps) => (
  <footer className={cn('border-t bg-muted/30 print:hidden', className)}>
    <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-4 text-muted-foreground text-sm">
      <nav aria-label={labels.label}>
        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <li>
            <a href={`${aboutBaseHref}/about/accessibility`} className={linkClass}>
              {labels.accessibility}
            </a>
          </li>
          <li>
            <a href={`${aboutBaseHref}/about/privacy`} className={linkClass}>
              {labels.privacy}
            </a>
          </li>
          <li>
            <a
              href={issuesHref}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(linkClass, 'inline-flex items-center gap-1.5')}
            >
              <GitHubIcon className="size-4 shrink-0" />
              {labels.reportIssue}
              <span className="sr-only"> {labels.opensInNewTab}</span>
            </a>
          </li>
        </ul>
      </nav>
      <p className="text-center">{labels.copyright}</p>
    </div>
  </footer>
);
