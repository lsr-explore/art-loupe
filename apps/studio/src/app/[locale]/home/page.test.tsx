import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => {
      const translations: Record<string, string> = {
        title: 'Studio',
        description: 'Your workspace.',
      };
      return translations[key] ?? key;
    }),
}));

import HomePage from './page';

// @trace flow=platform.shell category=functionality
describe('Studio home page', () => {
  it('renders the page heading', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Studio');
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const page = await HomePage();
    const { container } = render(page);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
