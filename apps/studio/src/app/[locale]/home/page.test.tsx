import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => {
      const translations: Record<string, string> = {
        title: 'Studio',
        description: 'Your workspace.',
        startProject: 'Start a project',
      };
      return translations[key] ?? key;
    }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import HomePage from './page';

// @trace flow=platform.shell category=functionality
describe('Studio home page', () => {
  it('renders the page heading', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Studio');
  });

  // A link rather than a button: it navigates and does nothing else, so it has to be openable
  // in a new tab and announced as a link. Asserting the role is what keeps it one.
  it('offers intake as a link to the project route', async () => {
    render(await HomePage());

    expect(screen.getByRole('link', { name: 'Start a project' })).toHaveAttribute(
      'href',
      '/projects/new',
    );
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const page = await HomePage();
    const { container } = render(page);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
