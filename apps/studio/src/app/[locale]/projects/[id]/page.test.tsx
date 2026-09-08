import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { PROJECT_ID } from '@/components/intake/intake-form.fixtures';

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    // Next's own `notFound()` throws to unwind the render, and the page relies on that: the
    // code after the guard assumes a validated id. A mock that merely records the call would
    // let execution continue and make the test pass for the wrong reason.
    throw new Error('NEXT_NOT_FOUND');
  }),
);

vi.mock('next/navigation', () => ({ notFound }));

vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => {
      const translations: Record<string, string> = {
        receivedTitle: 'Reference photograph received',
        receivedDescription: 'Your original is stored exactly as you sent it.',
        referenceLabel: 'Project reference',
        planPending: 'The plan for this project is not built yet.',
        startAnother: 'Start another project',
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

import ProjectPage from './page';

const renderFor = async (id: string) =>
  render(await ProjectPage({ params: Promise.resolve({ id }) }));

// @trace flow=intake.project-intent category=functionality
describe('Project page', () => {
  it('confirms the upload and says plainly that the plan is not built', async () => {
    await renderFor(PROJECT_ID);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Reference photograph received',
    );
    expect(screen.getByText('The plan for this project is not built yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start another project' })).toHaveAttribute(
      'href',
      '/projects/new',
    );
  });

  it('shows the project reference it was given', async () => {
    await renderFor(PROJECT_ID);

    expect(screen.getByText(PROJECT_ID)).toBeInTheDocument();
  });

  /**
   * A path segment is caller-controlled text and there is no read path yet to check it against,
   * so shape is the only thing this page can insist on. Echoing arbitrary text back as "your
   * project" would be a claim the page cannot support.
   */
  it.each(['not-a-uuid', '../../etc/passwd', '<script>alert(1)</script>', ''])(
    'refuses %j rather than presenting it as a project',
    async (id) => {
      await expect(renderFor(id)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(notFound).toHaveBeenCalled();
    },
  );

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = await renderFor(PROJECT_ID);
    expect(await axe(container)).toHaveNoViolations();
  });
});
