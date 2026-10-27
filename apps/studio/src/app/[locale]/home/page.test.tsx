import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const readProjects = vi.hoisted(() => vi.fn());
const peekAccessToken = vi.hoisted(() => vi.fn());
vi.mock('@artloupe/auth/server', () => ({ peekAccessToken }));
vi.mock('@/env', () => ({
  env: { SUPABASE_URL: 'http://supabase.test', SUPABASE_ANON_KEY: 'anon' },
}));
vi.mock('@/lib/projects/read-projects', () => ({ readProjects }));
beforeEach(() => {
  vi.clearAllMocks();
  peekAccessToken.mockResolvedValue({ state: 'valid', accessToken: 'artist-token' });
  readProjects.mockResolvedValue({ ok: true, projects: [], hasNext: false });
});

vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve(
      Object.assign(
        (key: string) => {
          const translations: Record<string, string> = {
            title: 'Studio',
            description: 'Your workspace.',
            startProject: 'Start a project',
          };
          return translations[key] ?? key;
        },
        { has: () => true },
      ),
    ),
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

// @trace flow=intake.project-intent category=functionality
describe('saved project selection', () => {
  it('links a saved reference to its project', async () => {
    readProjects.mockResolvedValue({
      ok: true,
      hasNext: false,
      projects: [
        {
          id: 'saved',
          title: 'Canal study',
          created_at: '2026-10-27T18:00:00Z',
          source_images: { storage_key: 'owner/saved/photo' },
          intent: { medium: 'oil', time_budget_minutes: 90 },
          runs: [{ status: 'succeeded' }],
        },
      ],
    });
    render(await HomePage());
    expect(screen.getByRole('link', { name: /Canal study/ })).toHaveAttribute(
      'href',
      '/projects/saved',
    );
    expect(readProjects).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'artist-token', page: 1 }),
    );
  });
  it('offers pagination for older projects', async () => {
    readProjects.mockResolvedValue({ ok: true, projects: [], hasNext: true });
    render(await HomePage({ searchParams: Promise.resolve({ page: '2' }) }));
    expect(screen.getByRole('link', { name: 'previous' })).toHaveAttribute('href', '/home?page=1');
    expect(screen.getByRole('link', { name: 'next' })).toHaveAttribute('href', '/home?page=3');
  });
  it('does not query saved projects with an expired token', async () => {
    peekAccessToken.mockResolvedValue({ state: 'expired' });
    render(await HomePage());
    expect(readProjects).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
