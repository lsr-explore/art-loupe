import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => {
      const translations: Record<string, string> = {
        orgName: 'Art Loupe',
        appName: 'Operations Control',
        logIn: 'Log In',
        description: 'Sign in to monitor agent activity, evaluation health, guardrails, and cost.',
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

// @trace flow=ops.observability category=functionality
describe('Dashboard landing page', () => {
  it('renders the heading and the login section', async () => {
    const page = await LandingPage();
    render(page);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Operations Control - Log In',
    );
    expect(screen.getByTestId('login-section')).toBeInTheDocument();
  });

  it('renders a decorative gradient backdrop and no photographic asset', async () => {
    const page = await LandingPage();
    const { container } = render(page);

    // the console takes a token-driven gradient, not an image. If one
    // is supplied later this is the assertion that should be changed deliberately.
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass('bg-linear-to-b');
    expect(container.querySelector('img')).toBeNull();
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const page = await LandingPage();
    const { container } = render(page);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
