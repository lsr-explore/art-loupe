import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => {
      const translations: Record<string, string> = {
        title: 'Start a project',
        description: 'Upload the reference photograph you are working from.',
      };
      return translations[key] ?? key;
    }),
}));

// The form has its own suite; this page's subject is the heading and the composition, so the
// client island is stubbed rather than rendered through a translation provider it does not
// otherwise need.
vi.mock('@/components/intake/intake-form', () => ({
  IntakeForm: () => <form aria-label="Intake" />,
}));

import NewProjectPage from './page';

// @trace flow=intake.project-intent category=functionality
describe('New project page', () => {
  it('renders the page heading and the intake form', async () => {
    render(await NewProjectPage());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Start a project');
    expect(screen.getByRole('form', { name: 'Intake' })).toBeInTheDocument();
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = render(await NewProjectPage());
    expect(await axe(container)).toHaveNoViolations();
  });
});
