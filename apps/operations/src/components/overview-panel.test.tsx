import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import messages from '../../messages/en.json';
import { mixedReport } from './costs/cost-panel.fixtures';
import { healthReport, quietReport } from './runs/run-health.fixtures';

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

import { OverviewPanel } from './overview-panel';

const renderPanel = (props: Partial<ComponentProps<typeof OverviewPanel>> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <OverviewPanel
        costs={{ status: 'ok', data: mixedReport }}
        runs={{ status: 'ok', data: healthReport }}
        window="7d"
        {...props}
      />
    </NextIntlClientProvider>,
  );

// @trace flow=ops.observability category=functionality
describe('Operations overview', () => {
  it('calculates success rate from completed runs and flags attention', () => {
    renderPanel({
      runs: {
        status: 'ok',
        data: {
          ...healthReport,
          run_count: 5,
          status_counts: { succeeded: 1, failed: 2, queued: 2, running: 0 },
        },
      },
    });
    expect(screen.getByText('33.3%')).toBeInTheDocument();
    expect(screen.getByText('Review failed or stalled runs')).toBeInTheDocument();
    expect(screen.getByText('Stalled across all time')).toBeInTheDocument();
  });

  it('keeps partial spend honest and links to the selected window', () => {
    renderPanel({ window: '30d' });
    expect(screen.getByText(/at least \$0.0315/)).toBeInTheDocument();
    expect(screen.getByText(/Some executions have unknown costs/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Explore costs/ })).toHaveAttribute(
      'href',
      '/home?window=30d&view=costs',
    );
    expect(screen.getAllByRole('link', { name: 'Run 0b5f6a3e' })[0]).toHaveAttribute(
      'href',
      `/runs/${healthReport.recent_runs[0]?.run_id}`,
    );
  });

  it('does not claim a success rate when there are no completed runs', () => {
    renderPanel({ runs: { status: 'ok', data: quietReport } });
    expect(screen.getByText('No monitored runs in this window')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent activity' })).not.toBeInTheDocument();
  });

  it('keeps available run data when costs are unavailable', () => {
    renderPanel({ costs: { status: 'unavailable' } });
    expect(screen.getByText('33.3%')).toBeInTheDocument();
    expect(screen.getByText(/This data is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('No unpriced executions reported.')).not.toBeInTheDocument();
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = renderPanel();
    expect(await axe(container)).toHaveNoViolations();
  });
});
