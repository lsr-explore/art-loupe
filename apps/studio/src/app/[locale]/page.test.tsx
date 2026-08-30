import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => {
      const translations: Record<string, string> = {
        orgName: 'Art Loupe',
        appName: 'Artist Studio',
        logIn: 'Log In',
        description: 'Sign in to check symptoms and review your recovery plan.',
      };
      return translations[key] ?? key;
    }),
  getLocale: () => Promise.resolve('en'),
}));

// LoginSection pulls in the server-side auth action chain; stub it for the
// presentational landing test. Its own behaviour is covered by e2e.
vi.mock('@/components/auth/login-section', () => ({
  LoginSection: () => <div data-testid="login-section" />,
}));

import LandingPage from './page';

// @trace flow=platform.shell category=functionality
describe('Companion landing page', () => {
  it('renders the heading and the login section', async () => {
    const page = await LandingPage();
    render(page);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Artist Studio - Log In');
    expect(screen.getByTestId('login-section')).toBeInTheDocument();
  });

  it('renders the backdrop as a decorative image, not an announced one', async () => {
    const page = await LandingPage();
    const { container } = render(page);

    const backdrop = container.querySelector('img');
    expect(backdrop).not.toBeNull();
    // Decorative: an empty alt keeps it out of the accessibility tree entirely. A
    // described beach is noise on a login screen, and axe cannot tell a wrong
    // description from a right one.
    expect(backdrop).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('applies the 0.75 to the image itself rather than as a scrim over it', async () => {
    const page = await LandingPage();
    const { container } = render(page);

    // A scrim would be a separate element over the photo; the settled
    // answer puts the opacity on the image so the page background shows through.
    expect(container.querySelector('img')).toHaveClass('opacity-75');
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const page = await LandingPage();
    const { container } = render(page);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
