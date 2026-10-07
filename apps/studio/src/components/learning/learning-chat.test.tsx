import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import fixture from '../../../../../packages/schemas/fixtures/learning-parity.json';
import messages from '../../../messages/en.json';
import { LearningChat } from './learning-chat';
const open = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LearningChat />
    </NextIntlClientProvider>,
  );
const ask = () => {
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'What is value?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
// @trace flow=retrieval.grounding category=functionality
describe('learning chat', () => {
  it('renders cited evidence and keeps follow-up context bounded', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(fixture.answer));
    open();
    ask();
    await screen.findByText('Value describes relative lightness or darkness.');
    expect(screen.getByRole('link', { name: 'Read supporting passage 1' })).toHaveAttribute(
      'href',
      expect.stringContaining('passage-value'),
    );
    expect(screen.getByText(fixture.answer.sources[0].excerpt)).toBeInTheDocument();
    expect(screen.getByText('Suggested exercise')).toBeInTheDocument();
    ask();
    await screen.findAllByText('Value describes relative lightness or darkness.');
    const payload = JSON.parse(String(fetch.mock.calls[1][1]?.body)) as {
      history: { role: string; content: string }[];
    };
    expect(payload.history).toHaveLength(2);
    expect(payload.history[0].role).toBe('user');
  });
  it('retains the draft when the service fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    open();
    ask();
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Your question')).toHaveValue('What is value?');
  });
  it('shows an evidence gap without invented citations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        ...fixture.answer,
        status: 'insufficient_evidence',
        claims: [],
        sources: [],
        practice: null,
        gap: 'The books do not answer this question.',
      }),
    );
    open();
    ask();
    await screen.findByText('The books do not answer this question.');
    expect(screen.queryByText('Supporting passages')).not.toBeInTheDocument();
  });
  // @trace category=a11y
  it('has accessible question controls', async () => {
    const { container } = open();
    expect(await axe(container)).toHaveNoViolations();
  });
});
