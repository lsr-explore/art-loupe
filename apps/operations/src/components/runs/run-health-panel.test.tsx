import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import messages from '../../../messages/en.json';
import { healthReport, quietReport } from './run-health.fixtures';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

import { RunHealthPanel } from './run-health-panel';

const renderPanel = (result: ComponentProps<typeof RunHealthPanel>['result']) =>
  render(
    (
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RunHealthPanel result={result} />
      </NextIntlClientProvider>
    ) as ReactNode,
  );

const rowFor = (table: string, rowName: string) =>
  within(screen.getByRole('table', { name: table }))
    .getByRole('rowheader', { name: rowName })
    .closest('tr') as HTMLElement;

// @trace flow=ops.observability category=functionality
describe('RunHealthPanel', () => {
  it('names each failure reason and the node it stopped in', () => {
    renderPanel({ status: 'ok', data: healthReport });
    expect(rowFor('Failures by reason', 'Deadline exceeded')).toHaveTextContent('plates');
  });

  it('shows an unknown reason code as it is, and a stop between nodes in words', () => {
    renderPanel({ status: 'ok', data: healthReport });
    expect(rowFor('Failures by reason', 'brand_new_reason')).toHaveTextContent('Between nodes');
  });

  it('lists stalled runs in their own table, tagged in words', () => {
    renderPanel({ status: 'ok', data: healthReport });
    const row = rowFor('Stalled runs', 'Run 0b5f6a3e');
    expect(row).toHaveTextContent('Running');
    expect(row).toHaveTextContent('Stalled');
  });

  it('links each run to its drill-down', () => {
    renderPanel({ status: 'ok', data: healthReport });
    const table = screen.getByRole('table', { name: 'Recent runs' });
    expect(within(table).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      '/runs/0b5f6a3e-2f4c-4d6b-9a8e-333333333333',
    );
  });

  it('says a finished run has no ledger yet rather than showing $0.00', () => {
    renderPanel({ status: 'ok', data: healthReport });
    const failed = within(screen.getByRole('table', { name: 'Recent runs' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(failed).toHaveTextContent('No ledger yet');
    expect(failed).not.toHaveTextContent('$0.00');
  });

  it('formats durations in seconds and minutes', () => {
    renderPanel({ status: 'ok', data: healthReport });
    expect(rowFor('How long runs took', 'Run time')).toHaveTextContent('10 s');
    expect(rowFor('How long runs took', 'Run time')).toHaveTextContent('1 min 15 s');
  });

  it('states the stall rule in minutes', () => {
    renderPanel({ status: 'ok', data: healthReport });
    expect(screen.getByText(/after 11 minutes is marked stalled/)).toBeInTheDocument();
  });

  it('says so when the window is quiet', () => {
    renderPanel({ status: 'ok', data: quietReport });
    expect(screen.getByText(/No agent runs were recorded/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('explains a failed read without a stall rule it does not have', () => {
    renderPanel({ status: 'unavailable' });
    expect(screen.getByText(/This data is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/marked stalled/)).not.toBeInTheDocument();
  });

  // @trace category=a11y
  it('does not rely on color for status', () => {
    renderPanel({ status: 'ok', data: healthReport });
    for (const marker of document.querySelectorAll('[data-run-status], [data-run-stalled]')) {
      expect(marker.textContent?.trim()).not.toBe('');
      expect(marker.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = renderPanel({ status: 'ok', data: healthReport });
    expect(await axe(container)).toHaveNoViolations();
  });
});
