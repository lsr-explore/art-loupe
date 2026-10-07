import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { RUN_RESULT } from '@/lib/runs/run-events.fixtures';

import messages from '../../../messages/en.json';
import { RoutingSummary } from './routing-summary';

const renderSummary = (routing = RUN_RESULT.routing) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RoutingSummary routing={routing} />
    </NextIntlClientProvider>,
  );

// @trace flow=intake.project-intent category=functionality
describe('RoutingSummary', () => {
  it('shows the rationale, every selection, and every declination with its reason (FR-307)', () => {
    renderSummary();

    expect(screen.getByText(RUN_RESULT.routing.rationale)).toBeInTheDocument();
    const selected = screen.getByRole('heading', { name: 'Selected' })
      .nextElementSibling as HTMLElement;
    expect(within(selected).getAllByRole('listitem')).toHaveLength(3);
    expect(within(selected).getByText('Head construction')).toBeInTheDocument();

    const declined = screen.getByRole('heading', { name: 'Declined' })
      .nextElementSibling as HTMLElement;
    expect(within(declined).getByText('Perspective')).toBeInTheDocument();
    expect(within(declined).getByText(/no vanishing point cleared/)).toBeInTheDocument();
  });

  it('says so when nothing was declined', () => {
    renderSummary({
      ...RUN_RESULT.routing,
      manifest: { ...RUN_RESULT.routing.manifest, declined: [] },
    });
    expect(screen.getByText('Nothing was declined.')).toBeInTheDocument();
  });

  it('shows a tool it has no name for as its id, rather than hiding it', () => {
    renderSummary({
      ...RUN_RESULT.routing,
      manifest: { selected: [{ tool: 'crop_candidates' as never, reason: null }], declined: [] },
    });
    expect(screen.getByText('crop_candidates')).toBeInTheDocument();
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = renderSummary();
    expect(await axe(container)).toHaveNoViolations();
  });
});
