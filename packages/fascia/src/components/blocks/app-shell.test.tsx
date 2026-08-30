import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { AppShell, type AppShellLabels } from './app-shell';
import { UserChip } from './user-chip';

/** Stands in for each app's locale-aware `Link` from `@/i18n/navigation`. */
const Link = ({ href, className, children, ...rest }: ComponentProps<'a'>) => (
  <a href={href} className={className} {...rest}>
    {children}
  </a>
);

const labels: AppShellLabels = {
  orgName: 'Art Loupe',
  appName: 'Artist Studio',
  banner: 'Demonstration only — not a valuation, authentication, or legal opinion.',
  skipToContent: 'Skip to main content',
  sidebarLabel: 'Sections',
  openSidebar: 'Open sections menu',
  closeSidebar: 'Close sections menu',
  theme: { label: 'Theme', system: 'System', light: 'Light', dark: 'Dark' },
  footer: {
    label: 'Site information',
    accessibility: 'Accessibility',
    privacy: 'Privacy Policy',
    reportIssue: 'Report an Issue',
    opensInNewTab: '(opens in a new tab)',
    copyright: '© 2026 Laurie Reynolds. All rights reserved.',
  },
};

const renderShell = (overrides: Partial<ComponentProps<typeof AppShell>> = {}) =>
  render(
    <AppShell
      labels={labels}
      linkComponent={Link}
      languageControl={<div data-testid="language-control" />}
      {...overrides}
    >
      <p>Page content</p>
    </AppShell>,
  );

// @trace flow=platform.shell category=functionality
describe('AppShell', () => {
  it('renders the org name and the app name after a separator', () => {
    renderShell();

    expect(screen.getByText('Art Loupe')).toBeInTheDocument();
    expect(screen.getByText('Artist Studio')).toBeInTheDocument();
  });

  it('omits the app name when the surface has none', () => {
    renderShell({ labels: { ...labels, appName: undefined } });

    expect(screen.getByText('Art Loupe')).toBeInTheDocument();
    expect(screen.queryByText('Artist Studio')).not.toBeInTheDocument();
  });

  // Two destinations, not one. The org lockup is the only route off this surface,
  // so a single combined link left no way to reach another app from inside one.
  it('sends the org lockup to the entry point and the app name to this surface', () => {
    renderShell({ orgHref: 'http://localhost:3003', homeHref: '/home' });

    expect(screen.getByRole('link', { name: /Art Loupe/ })).toHaveAttribute(
      'href',
      'http://localhost:3003',
    );
    expect(screen.getByRole('link', { name: 'Artist Studio' })).toHaveAttribute('href', '/home');
  });

  // The entry point *is* the organisation's front door, so its lockup stays local.
  it('falls the org lockup back to homeHref when no entry origin is supplied', () => {
    renderShell({ labels: { ...labels, appName: undefined } });

    expect(screen.getByRole('link', { name: /Art Loupe/ })).toHaveAttribute('href', '/');
  });

  // role="note", never role="alert": an alert that never clears and cannot be
  // dismissed trains people to ignore alerts.
  it('carries the demo disclaimer as a permanent note, not an alert', () => {
    renderShell();

    expect(screen.getByRole('note')).toHaveTextContent('not a valuation');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // role="note" is not a landmark, so a banner sitting between <body> and <header>
  // leaves page content outside every landmark — axe's `region` rule, caught by the
  // browser e2e run and invisible to jsdom.
  it('keeps the disclaimer inside the banner landmark', () => {
    renderShell();

    expect(screen.getByRole('banner')).toContainElement(screen.getByRole('note'));
  });

  it('puts the skip link ahead of the banner and points it at main', () => {
    const { container } = renderShell();

    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    // First focusable in the document, or it cannot bypass anything.
    expect(container.firstElementChild).toBe(skip);
    expect(skip).toHaveAttribute('href', '#main-content');

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    // Without tabIndex the target is unfocusable and the next Tab resumes from the
    // skip link — the bug that makes skip links look decorative.
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('renders children inside the main landmark', () => {
    renderShell();

    expect(within(screen.getByRole('main')).getByText('Page content')).toBeInTheDocument();
  });

  it('orders the header controls: leading, theme, language, user', () => {
    renderShell({
      leadingControl: <a href="/about">About</a>,
      userControl: (
        <UserChip
          username="demo.artist@demo.artloupestudio.com"
          signedInAsLabel="Signed in as"
          signOutLabel="Sign out"
          signOutAction={() => {}}
        />
      ),
    });

    const header = screen.getByRole('banner');
    const order = [
      within(header).getByRole('link', { name: 'About' }),
      within(header).getByRole('group', { name: 'Theme' }),
      within(header).getByTestId('language-control'),
      within(header).getByText('demo.artist@demo.artloupestudio.com'),
    ];

    for (let index = 1; index < order.length; index += 1) {
      // DOCUMENT_POSITION_FOLLOWING === 4
      expect(order[index - 1].compareDocumentPosition(order[index]) & 4).toBe(4);
    }
  });

  it('omits the user chip when signed out', () => {
    renderShell();

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByText('Signed in as')).not.toBeInTheDocument();
  });

  it('renders no sidebar when the slot is omitted', () => {
    renderShell();

    expect(screen.queryByRole('navigation', { name: 'Sections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open sections menu' })).not.toBeInTheDocument();
  });

  it('renders the sidebar and its mobile trigger when the slot is filled', () => {
    renderShell({ sidebar: <a href="/critique">Critique Queue</a> });

    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).getByRole('link', { name: 'Critique Queue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open sections menu/ })).toBeInTheDocument();
  });

  it('points the footer links at the About site and the repo issues', () => {
    renderShell({ aboutBaseHref: 'https://artloupestudio.com' });

    expect(screen.getByRole('link', { name: 'Accessibility' })).toHaveAttribute(
      'href',
      'https://artloupestudio.com/about/accessibility',
    );
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      'https://artloupestudio.com/about/privacy',
    );

    const issue = screen.getByRole('link', { name: /Report an Issue/ });
    expect(issue).toHaveAttribute('href', 'https://github.com/lsr-explore/art-loupe/issues');
    expect(issue).toHaveAttribute('rel', 'noopener noreferrer');
    // The new-tab affordance is announced, not just implied by target="_blank".
    expect(issue).toHaveAccessibleName(expect.stringContaining('(opens in a new tab)'));
  });

  it('links the About site same-origin when no base href is supplied', () => {
    renderShell();

    expect(screen.getByRole('link', { name: 'Accessibility' })).toHaveAttribute(
      'href',
      '/about/accessibility',
    );
  });

  it('renders the copyright the app formatted', () => {
    renderShell();

    expect(screen.getByText('© 2026 Laurie Reynolds. All rights reserved.')).toBeInTheDocument();
  });

  // @trace category=a11y
  it('has no accessibility violations when signed in with a sidebar', async () => {
    const { container } = renderShell({
      sidebar: <a href="/critique">Critique Queue</a>,
      userControl: (
        <UserChip
          username="demo.artist@demo.artloupestudio.com"
          signedInAsLabel="Signed in as"
          signOutLabel="Sign out"
          signOutAction={() => {}}
        />
      ),
    });

    expect(await axe(container)).toHaveNoViolations();
  });
});
