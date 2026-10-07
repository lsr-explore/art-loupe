import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const fetchCostReport = vi.hoisted(() => vi.fn());

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
// The panel has its own suite; here it only has to receive the window the page chose.
vi.mock('@/components/costs/cost-panel', () => ({
  CostPanel: ({ costWindow }: { costWindow: string }) => (
    <section aria-label="Agent cost" data-window={costWindow} />
  ),
}));

import HomePage from './page';

const renderPage = async (search: Record<string, string> = {}) => {
  fetchCostReport.mockResolvedValue({ status: 'unavailable' });
  return render(await HomePage({ searchParams: Promise.resolve(search) }));
};

// @trace flow=ops.observability category=functionality
describe('Operations home page', () => {
  it('renders the page heading', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Operations');
  });

  it('defaults the cost window to seven days', async () => {
    await renderPage();
    expect(fetchCostReport).toHaveBeenCalledWith('7d');
  });

  it('honours a known window and ignores an unknown one', async () => {
    await renderPage({ window: '30d' });
    expect(fetchCostReport).toHaveBeenLastCalledWith('30d');
    await renderPage({ window: '1y' });
    expect(fetchCostReport).toHaveBeenLastCalledWith('7d');
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = await renderPage();
    expect(await axe(container)).toHaveNoViolations();
  });
});
