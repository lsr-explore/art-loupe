import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

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

import HomePage from './page';

const renderPage = async (search: Record<string, string> = {}) => {
  fetchCostReport.mockResolvedValue({ status: 'unavailable' });
  fetchRunHealth.mockResolvedValue({ status: 'unavailable' });
  return render(await HomePage({ searchParams: Promise.resolve(search) }));
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

  it('renders the cost panel, then run health', async () => {
    await renderPage();
    const sections = screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-label'));
    expect(sections).toEqual(['Agent cost', 'Run health']);
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = await renderPage();
    expect(await axe(container)).toHaveNoViolations();
  });
});
