import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import messages from '../../../../messages/en.json';

const fetchCostReport = vi.hoisted(() => vi.fn());
const fetchRunHealth = vi.hoisted(() => vi.fn());

vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => {
      const translations: Record<string, string> = {
        title: 'Operations',
        description: 'Cost, evaluation health, and ingestion for the studio agents.',
      };
      return translations[key] ?? key;
    }),
}));
vi.mock('@/lib/costs/fetch-cost-report', () => ({ fetchCostReport }));
vi.mock('@/lib/runs/fetch-runs', () => ({ fetchRunHealth }));
// Each panel and the window links have their own suites; here they only have to be placed.
vi.mock('@/components/costs/cost-panel', () => ({
  CostPanel: () => <section aria-label="Agent cost" />,
}));
vi.mock('@/components/runs/run-health-panel', () => ({
  RunHealthPanel: () => <section aria-label="Run health" />,
}));
vi.mock('@/components/window-nav', () => ({
  WindowNav: ({ current }: { current: string }) => <nav aria-label="Time window">{current}</nav>,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: Omit<ComponentProps<'a'>, 'href'> & {
    href: string | { pathname: string; query: Record<string, string> };
  }) => (
    <a
      href={typeof href === 'string' ? href : `${href.pathname}?${new URLSearchParams(href.query)}`}
      {...rest}
    >
      {children}
    </a>
  ),
}));

import HomePage from './page';

const renderPage = async (search: Record<string, string> = {}) => {
  fetchCostReport.mockResolvedValue({ status: 'unavailable' });
  fetchRunHealth.mockResolvedValue({ status: 'unavailable' });
  const page = await HomePage({ searchParams: Promise.resolve(search) });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {page}
    </NextIntlClientProvider>,
  );
};

// @trace flow=ops.observability category=functionality
describe('Operations home page', () => {
  it('renders the page heading', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Operations');
  });

  it('defaults both panels to a seven-day window', async () => {
    await renderPage();
    expect(fetchCostReport).toHaveBeenCalledWith('7d');
    expect(fetchRunHealth).toHaveBeenCalledWith('7d');
  });

  it('honours a known window and ignores an unknown one', async () => {
    await renderPage({ window: '30d' });
    expect(fetchCostReport).toHaveBeenLastCalledWith('30d');
    expect(fetchRunHealth).toHaveBeenLastCalledWith('30d');
    await renderPage({ window: '1y' });
    expect(fetchRunHealth).toHaveBeenLastCalledWith('7d');
  });

  it('opens the overview by default without detailed tables', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'At a glance' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Agent cost' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens costs and preserves the window in navigation', async () => {
    await renderPage({ view: 'costs', window: '30d' });
    expect(screen.getByRole('region', { name: 'Agent cost' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Run health' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Run health' })).toHaveAttribute(
      'href',
      '/home?window=30d&view=runs',
    );
  });

  it('opens run health', async () => {
    await renderPage({ view: 'runs' });
    expect(screen.getByRole('region', { name: 'Run health' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Agent cost' })).not.toBeInTheDocument();
  });

  it('falls back to overview for an unknown view', async () => {
    await renderPage({ view: 'unknown' });
    expect(screen.getByRole('heading', { name: 'At a glance' })).toBeInTheDocument();
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = await renderPage();
    expect(await axe(container)).toHaveNoViolations();
  });
});
