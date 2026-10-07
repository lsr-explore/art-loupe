import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { ReadProjectResult } from '@/lib/projects/read-project';
import { PROJECT_ID, RUN_ID } from '@/lib/runs/run-events.fixtures';

import messages from '../../../../../messages/en.json';

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    // Next's own `notFound()` throws to unwind the render, and the page relies on that: the
    // code after the guard assumes a validated id. A mock that merely records the call would
    // let execution continue and make the test pass for the wrong reason.
    throw new Error('NEXT_NOT_FOUND');
  }),
);
const peekAccessToken = vi.hoisted(() => vi.fn());
const logout = vi.hoisted(() => vi.fn());
const readProject = vi.hoisted(() => vi.fn<() => Promise<ReadProjectResult>>());
const runPanel = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@artloupe/auth/server', () => ({ peekAccessToken }));
vi.mock('@/app/[locale]/actions', () => ({ logout }));
vi.mock('@/lib/projects/read-project', () => ({ readProject }));
vi.mock('@/env', () => ({
  env: { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'anon' },
}));

// The panel is a client component with its own suite. Here it is a marker that records its props.
vi.mock('@/components/project/run-panel', () => ({
  RunPanel: (props: { projectId: string; initialRunId: string | null }) => {
    runPanel(props);
    return <section aria-label="run panel" />;
  },
}));

vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => (messages.project as Record<string, unknown>)[key] ?? key),
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
  render(await ProjectPage({ params: Promise.resolve({ locale: 'en', id }) }));

const found = (overrides: Partial<Extract<ReadProjectResult, { ok: true }>['project']> = {}) =>
  ({
    ok: true,
    project: {
      projectId: PROJECT_ID,
      intent: { medium: 'graphite' },
      original: {
        storageKey: `owner/${PROJECT_ID}/${'a'.repeat(64)}`,
        widthPx: 1600,
        heightPx: 1200,
      },
      latestRun: null,
      ...overrides,
    },
  }) satisfies ReadProjectResult;

beforeEach(() => {
  vi.clearAllMocks();
  peekAccessToken.mockResolvedValue({ state: 'valid', accessToken: 'artist-token' });
  readProject.mockResolvedValue(found());
});

// @trace flow=intake.project-intent category=functionality
describe('Project page', () => {
  it('shows the reference photograph through the image route, with its dimensions', async () => {
    await renderFor(PROJECT_ID);

    const photo = screen.getByRole('img', { name: 'The reference photograph for this project' });
    expect(photo).toHaveAttribute('src', `/api/images/owner/${PROJECT_ID}/${'a'.repeat(64)}`);
    expect(photo).toHaveAttribute('width', '1600');
    expect(photo).toHaveAttribute('height', '1200');
  });

  it('says plainly that the plan is not built yet', async () => {
    await renderFor(PROJECT_ID);
    expect(screen.getByText(/working plan is not built yet/)).toBeInTheDocument();
  });

  it('hands the run panel the project and no run when there is none', async () => {
    await renderFor(PROJECT_ID);
    expect(runPanel).toHaveBeenCalledWith({ projectId: PROJECT_ID, initialRunId: null });
  });

  it('hands the run panel the latest run, so a reload follows it', async () => {
    readProject.mockResolvedValue(found({ latestRun: { runId: RUN_ID, status: 'running' } }));
    await renderFor(PROJECT_ID);
    expect(runPanel).toHaveBeenCalledWith({ projectId: PROJECT_ID, initialRunId: RUN_ID });
  });

  it('says so when the project has no photograph yet', async () => {
    readProject.mockResolvedValue(found({ original: null }));
    await renderFor(PROJECT_ID);
    expect(screen.getByText('This project has no reference photograph yet.')).toBeInTheDocument();
  });

  it('says the project could not be loaded when the data service fails', async () => {
    readProject.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await renderFor(PROJECT_ID);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
    expect(runPanel).not.toHaveBeenCalled();
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = await renderFor(PROJECT_ID);
    expect(await axe(container)).toHaveNoViolations();
  });
});

// @trace flow=intake.project-intent category=security
describe('Project page ownership', () => {
  /**
   * A path segment is caller-controlled text, and it is interpolated into a PostgREST filter.
   * Shape is checked before the database is asked anything.
   */
  it.each(['not-a-uuid', '../../etc/passwd', '<script>alert(1)</script>', ''])(
    'refuses %j without reading anything',
    async (id) => {
      await expect(renderFor(id)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(readProject).not.toHaveBeenCalled();
    },
  );

  it('answers 404 when RLS hides the project, absent and foreign alike', async () => {
    readProject.mockResolvedValue({ ok: false, reason: 'not-found' });
    await expect(renderFor(PROJECT_ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('answers 404 for a session with no Supabase tokens, which owns nothing', async () => {
    peekAccessToken.mockResolvedValue({ state: 'none' });
    await expect(renderFor(PROJECT_ID)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(readProject).not.toHaveBeenCalled();
  });

  it('offers sign-in again for an expired token, without reading or writing anything', async () => {
    peekAccessToken.mockResolvedValue({ state: 'expired' });
    await renderFor(PROJECT_ID);

    expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired');
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
    expect(readProject).not.toHaveBeenCalled();
  });

  it('reads the project with the artist token', async () => {
    await renderFor(PROJECT_ID);
    expect(readProject).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'artist-token', projectId: PROJECT_ID }),
    );
  });
});
