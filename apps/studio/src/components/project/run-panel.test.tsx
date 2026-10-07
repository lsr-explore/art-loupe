import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { PROJECT_ID, RUN_ID, RUN_RESULT } from '@/lib/runs/run-events.fixtures';

import messages from '../../../messages/en.json';
import { RunPanel } from './run-panel';
import { FakeEventSource } from './run-panel.fixtures';

const renderPanel = (initialRunId: string | null = null) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RunPanel projectId={PROJECT_ID} initialRunId={initialRunId} />
    </NextIntlClientProvider>,
  );

const fetchMock = vi.fn();

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(Response.json({ runId: RUN_ID }, { status: 202 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const startRun = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Analyse this reference' }));
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  return FakeEventSource.latest();
};

// @trace flow=intake.project-intent category=functionality
describe('RunPanel', () => {
  it('starts nothing until the artist asks', () => {
    renderPanel();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('starts a run on request and follows its stream', async () => {
    renderPanel();
    const source = await startRun();

    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${PROJECT_ID}/runs`, { method: 'POST' });
    expect(source.url).toBe(`/api/runs/${RUN_ID}/events`);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('announces the current step, then the routing decision', async () => {
    renderPanel();
    const source = await startRun();

    act(() => {
      source.emit('started', {}, '1');
      source.emit('node_started', { node: 'face_gate' }, '2');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Working: Looking for a face');

    act(() => source.emit('succeeded', RUN_RESULT, '3'));
    expect(screen.getByRole('status')).toHaveTextContent('The analysis has finished.');
    expect(screen.getByText(RUN_RESULT.routing.rationale)).toBeInTheDocument();
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });

  it('follows an existing run at once, without starting another', () => {
    renderPanel(RUN_ID);
    expect(FakeEventSource.latest().url).toBe(`/api/runs/${RUN_ID}/events`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a failed run in the artist language, and offers to try again', async () => {
    renderPanel(RUN_ID);
    act(() =>
      FakeEventSource.latest().emit('failed', { reason: 'budget_exceeded', detail: 'spent' }, '1'),
    );

    expect(screen.getByText('This project has used its analysis budget.')).toBeInTheDocument();
    expect(screen.queryByText('spent')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it("treats the studio's id-less notice as a stream it could not read", () => {
    renderPanel(RUN_ID);
    act(() =>
      FakeEventSource.latest().emit('failed', { reason: 'invalid_stream', detail: 'x' }, ''),
    );
    expect(
      screen.getByText('The analysis service sent an update that could not be read.'),
    ).toBeInTheDocument();
  });

  it('says contact was lost when the stream is refused before the run ends', () => {
    renderPanel(RUN_ID);
    act(() => FakeEventSource.latest().fail());
    expect(screen.getByText('Lost contact with the analysis')).toBeInTheDocument();
  });

  it('says the run could not start when the studio refuses', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'agent_unavailable' }, { status: 503 }));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Analyse this reference' }));

    expect(await screen.findByText('The analysis could not be started')).toBeInTheDocument();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('closes its stream when it unmounts', () => {
    const { unmount } = renderPanel(RUN_ID);
    unmount();
    expect(FakeEventSource.latest().readyState).toBe(FakeEventSource.CLOSED);
  });

  // @trace category=a11y
  it('has no accessibility violations once a run has finished', async () => {
    const { container } = renderPanel(RUN_ID);
    act(() => FakeEventSource.latest().emit('succeeded', RUN_RESULT, '1'));
    expect(await axe(container)).toHaveNoViolations();
  });
});
