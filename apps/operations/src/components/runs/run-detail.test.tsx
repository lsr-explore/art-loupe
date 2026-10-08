import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import messages from '../../../messages/en.json';
import { RunDetailView } from './run-detail';
import { failedDetail } from './run-health.fixtures';

const renderDetail = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <RunDetailView detail={failedDetail} />
    </NextIntlClientProvider>,
  );

// @trace flow=ops.observability category=functionality
describe('RunDetailView', () => {
  it('marks the node that never finished in words', () => {
    renderDetail();
    const steps = screen.getByRole('table', { name: 'Node steps' });
    const plates = within(steps).getByRole('rowheader', { name: 'plates' }).closest('tr');
    expect(plates).toHaveTextContent('Did not finish');
    const route = within(steps).getByRole('rowheader', { name: 'route' }).closest('tr');
    expect(route).toHaveTextContent('1 s');
  });

  it('says a step whose start was lost has no recorded start', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RunDetailView
          detail={{
            ...failedDetail,
            steps: [
              {
                node: 'survey',
                started_at: null,
                finished_at: '2026-10-07T11:00:03Z',
                duration_ms: null,
              },
            ],
          }}
        />
      </NextIntlClientProvider>,
    );
    const steps = screen.getByRole('table', { name: 'Node steps' });
    const survey = within(steps).getByRole('rowheader', { name: 'survey' }).closest('tr');
    expect(survey).toHaveTextContent('Not recorded');
    // It did finish; only its start is missing.
    expect(survey).not.toHaveTextContent('Did not finish');
  });

  it('shows the reason and the detail the artist saw', () => {
    renderDetail();
    expect(screen.getByText('Deadline exceeded', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('The run ran out of time.')).toBeInTheDocument();
  });

  it('lists every event in order, the failure with its reason', () => {
    renderDetail();
    const rows = within(screen.getByRole('table', { name: 'Event log' })).getAllByRole('row');
    expect(rows).toHaveLength(6);
    expect(rows[5]).toHaveTextContent('Run failed');
    expect(rows[5]).toHaveTextContent('Deadline exceeded');
  });

  it('says a run with no ledger has no cost yet', () => {
    renderDetail();
    expect(screen.queryByRole('table', { name: 'Ledger by node' })).not.toBeInTheDocument();
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = renderDetail();
    expect(await axe(container)).toHaveNoViolations();
  });
});
