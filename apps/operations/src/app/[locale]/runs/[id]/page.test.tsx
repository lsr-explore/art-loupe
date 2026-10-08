import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const fetchRunDetail = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
);

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve((key: string, values?: { id?: string }) =>
      key === 'title' ? `Run ${values?.id}` : key === 'back' ? 'Back to operations' : key,
    ),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/runs/fetch-runs', () => ({ fetchRunDetail }));
// The view and the state message have their own suites.
vi.mock('@/components/runs/run-detail', () => ({
  RunDetailView: () => <section aria-label="Run detail" />,
}));
vi.mock('@/components/ops-state-message', () => ({
  OpsStateMessage: ({ status }: { status: string }) => <p>{status}</p>,
}));

import RunPage from './page';

const RUN_ID = '0b5f6a3e-2f4c-4d6b-9a8e-333333333333';
const page = (id: string) => RunPage({ params: Promise.resolve({ locale: 'en', id }) });

// @trace flow=ops.observability category=functionality
describe('Run page', () => {
  beforeEach(() => {
    fetchRunDetail.mockReset();
    notFound.mockClear();
  });

  it('renders the drill-down under a heading naming the run', async () => {
    fetchRunDetail.mockResolvedValue({ status: 'ok', data: {} });
    render(await page(RUN_ID));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Run 0b5f6a3e');
    expect(screen.getByRole('region', { name: 'Run detail' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to operations' })).toHaveAttribute(
      'href',
      '/home',
    );
  });

  // @trace category=security
  it('answers an id that cannot be a run without asking the agent', async () => {
    await expect(page('../../ops/costs')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fetchRunDetail).not.toHaveBeenCalled();
  });

  it('is a 404 when the agent has no such run', async () => {
    fetchRunDetail.mockResolvedValue({ status: 'not-found' });
    await expect(page(RUN_ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('explains any other failed read', async () => {
    fetchRunDetail.mockResolvedValue({ status: 'unavailable' });
    render(await page(RUN_ID));
    expect(screen.getByText('unavailable')).toBeInTheDocument();
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    fetchRunDetail.mockResolvedValue({ status: 'ok', data: {} });
    const { container } = render(await page(RUN_ID));
    expect(await axe(container)).toHaveNoViolations();
  });
});
