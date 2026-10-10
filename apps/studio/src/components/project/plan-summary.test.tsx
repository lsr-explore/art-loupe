import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { PlanOutcome } from '@/lib/runs/run-contract';
import { PLAN_OUTCOME } from '@/lib/runs/run-events.fixtures';

import messages from '../../../messages/en.json';
import { PlanSummary } from './plan-summary';

const renderSummary = (outcome: PlanOutcome = PLAN_OUTCOME) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PlanSummary outcome={outcome} />
    </NextIntlClientProvider>,
  );

const section = (name: RegExp) =>
  screen.getByRole('heading', { name }).closest('section') as HTMLElement;

// @trace flow=plan.synthesis category=functionality
describe('PlanSummary', () => {
  it('leads with the materials list, before the assessment and the stages (FR-607)', () => {
    renderSummary();

    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(headings.indexOf('Materials')).toBeLessThan(
      headings.findIndex((text) => text?.startsWith('How well the reference')),
    );
    expect(within(section(/^Materials$/)).getByText(/a medium hog-bristle filbert/)).toBeVisible();
  });

  it('labels every claim with its evidence class in words, not colour', () => {
    renderSummary();

    expect(screen.getAllByText('Measured:').length).toBeGreaterThan(0);
    expect(screen.getByText('Cited:')).toBeInTheDocument();
    expect(screen.getByText('Chosen:')).toBeInTheDocument();
    expect(screen.getByText(/measured by the Value map study/)).toBeInTheDocument();
    expect(screen.getByText(/from Art Loupe fixture lessons/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /because the darks carry the composition, rather than starting from the outline/,
      ),
    ).toBeInTheDocument();
  });

  it('shows the stages in order, with their minutes and the materials they use', () => {
    renderSummary();

    const stages = section(/^Stages/);
    const titles = within(stages)
      .getAllByRole('heading', { level: 4 })
      .map((node) => node.textContent);
    expect(titles).toEqual(['Block in the darks — 60 minutes', 'Refine the edges — 30 minutes']);
    expect(within(stages).getByText('(90 minutes in all)')).toBeInTheDocument();
    expect(within(stages).getAllByText('a medium hog-bristle filbert')).toHaveLength(2);
  });

  it('says plainly when a stage rests on nothing', () => {
    renderSummary();
    expect(screen.getByText('Nothing yet. The Plan Critic flags this.')).toBeInTheDocument();
  });

  // @trace flow=plan.critique
  it('shows the final verdict with its open defects, and what the first review found', () => {
    renderSummary();

    expect(
      screen.getByRole('heading', { name: "The Plan Critic's verdict: Ready, with cautions" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/rests on no finding, lesson or choice/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "The Studio Planner revised this plan once, after the Plan Critic's first review.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/add up to 60 minutes/)).toBeInTheDocument();
  });

  // @trace flow=plan.critique
  it('says the Plan Critic found nothing when a first plan is ready', () => {
    renderSummary({
      ...PLAN_OUTCOME,
      verdicts: [{ verdict: 'READY', defects: [], summary: 'Fits.', revision: 0 }],
    });

    expect(screen.getByText('The Plan Critic found nothing to change.')).toBeInTheDocument();
    expect(screen.queryByText(/revised this plan once/)).not.toBeInTheDocument();
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = renderSummary();
    expect(await axe(container)).toHaveNoViolations();
  });
});
