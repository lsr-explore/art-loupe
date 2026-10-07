import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import messages from '../../../messages/en.json';
import { emptyReport, mixedReport } from './cost-panel.fixtures';

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: Omit<ComponentProps<'a'>, 'href'> & { href: { query: { window: string } } }) => (
    <a href={`/home?window=${href.query.window}`} {...rest}>
      {children}
    </a>
  ),
}));

import { CostPanel } from './cost-panel';

const withIntl = (ui: ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    {ui}
  </NextIntlClientProvider>
);

const renderPanel = (props: ComponentProps<typeof CostPanel>) =>
  render(withIntl(<CostPanel {...props} />));

const rowFor = (tableName: string, rowName: string) =>
  within(screen.getByRole('table', { name: tableName }))
    .getByRole('rowheader', { name: rowName })
    .closest('tr') as HTMLElement;

// @trace flow=ops.observability category=functionality
describe('CostPanel', () => {
  it('renders a real zero as $0.00', () => {
    renderPanel({ costWindow: '7d', result: { status: 'ok', report: mixedReport } });
    expect(rowFor('Spend by model', 'Deterministic (no model)')).toHaveTextContent('$0.00');
  });

  it('renders an unpriced cost as the word, never as $0.00', () => {
    renderPanel({ costWindow: '7d', result: { status: 'ok', report: mixedReport } });
    const row = rowFor('Spend by model', 'claude-unknown-9');
    expect(row).toHaveTextContent('Unpriced');
    expect(row).not.toHaveTextContent('$0.00');
  });

  it('states a sum with unpriced rows as a lower bound', () => {
    renderPanel({ costWindow: '7d', result: { status: 'ok', report: mixedReport } });
    expect(rowFor('Spend by node', 'route')).toHaveTextContent('at least $0.0315');
    expect(rowFor('Spend by node', 'route')).toHaveTextContent('1 unpriced');
  });

  it('carries the lower bound into the spend total', () => {
    renderPanel({ costWindow: '7d', result: { status: 'ok', report: mixedReport } });
    const spend = screen.getByRole('heading', { name: 'Spend' }).closest('[data-slot="card"]');
    expect(spend).toHaveTextContent('at least $0.0315');
  });

  it('marks the current window and links the others', () => {
    renderPanel({ costWindow: '7d', result: { status: 'ok', report: mixedReport } });
    const nav = screen.getByRole('navigation', { name: 'Time window' });
    expect(within(nav).getByRole('link', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Last 30 days' })).toHaveAttribute(
      'href',
      '/home?window=30d',
    );
  });

  it('says how many runs it left out', () => {
    renderPanel({
      costWindow: '7d',
      result: { status: 'ok', report: { ...mixedReport, run_count: 120 } },
    });
    expect(screen.getByText('Showing the 2 most recent of 120 runs.')).toBeInTheDocument();
  });

  it('says so when the window is empty rather than rendering empty tables', () => {
    renderPanel({ costWindow: '24h', result: { status: 'ok', report: emptyReport } });
    expect(screen.getByText(/No agent activity/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it.each([
    ['unavailable', 'Cost data is unavailable'],
    ['forbidden', 'not permitted'],
    ['signed-out', 'Sign in again'],
  ] as const)('explains the %s state', (status, text) => {
    renderPanel({ costWindow: '7d', result: { status } });
    expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
  });

  // @trace category=a11y
  it('does not rely on color to tell unpriced from zero', () => {
    renderPanel({ costWindow: '7d', result: { status: 'ok', report: mixedReport } });
    const marker = rowFor('Spend by model', 'claude-unknown-9').querySelector(
      '[data-cost="unpriced"]',
    );
    // The text is the signal; the icon is decoration and is hidden from assistive technology.
    expect(marker).toHaveTextContent('Unpriced');
    expect(marker?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  // @trace category=a11y
  it('has no accessibility violations with data', async () => {
    const { container } = renderPanel({
      costWindow: '7d',
      result: { status: 'ok', report: mixedReport },
    });
    expect(await axe(container)).toHaveNoViolations();
  });

  // @trace category=a11y
  it('has no accessibility violations when unavailable', async () => {
    const { container } = renderPanel({ costWindow: '7d', result: { status: 'unavailable' } });
    expect(await axe(container)).toHaveNoViolations();
  });
});
