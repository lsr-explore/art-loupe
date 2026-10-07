// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  agentFrame,
  RUN_ID,
  RUN_RESULT,
  streamOf,
  SUCCESSFUL_RUN,
  textOf,
} from './run-events.fixtures';
import { readSseFrames, type SseFrame } from './sse';

const loggerError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger: { error: loggerError } }));

const { relayRunEvents } = await import('./relay-run-events');

const relayed = async (chunks: string[]): Promise<SseFrame[]> => {
  const frames: SseFrame[] = [];
  for await (const frame of readSseFrames(relayRunEvents(streamOf(chunks), RUN_ID))) {
    frames.push(frame);
  }
  return frames;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// @trace flow=intake.project-intent category=functionality
describe('relaying a run stream', () => {
  it('relays every valid event with its id, and passes heartbeats on', async () => {
    const frames = await relayed(SUCCESSFUL_RUN);

    expect(frames.filter((frame) => frame.comment)).toHaveLength(1);
    expect(
      frames.filter((frame) => !frame.comment).map((frame) => [frame.id, frame.event]),
    ).toEqual([
      ['1', 'started'],
      ['2', 'node_started'],
      ['3', 'node_finished'],
      ['4', 'succeeded'],
    ]);
    const succeeded = frames.find((frame) => frame.event === 'succeeded');
    expect(JSON.parse(succeeded?.data ?? '')).toEqual(RUN_RESULT);
  });

  it('starts with its own retry interval', async () => {
    const text = await textOf(relayRunEvents(streamOf([]), RUN_ID));
    expect(text.startsWith('retry: 1000\n\n')).toBe(true);
  });

  it('stops after the terminal event even if more arrives', async () => {
    const frames = await relayed([
      agentFrame(1, 'failed', { reason: 'interrupted', detail: 'stopped' }),
      agentFrame(2, 'started', {}),
    ]);
    expect(frames.map((frame) => frame.event)).toEqual(['failed']);
  });
});

// @trace flow=intake.project-intent category=safety
describe('an event the contract refuses', () => {
  it.each([
    ['an unknown kind', agentFrame(1, 'exploded', {})],
    [
      'a decision missing its rationale',
      agentFrame(1, 'succeeded', {
        ...RUN_RESULT,
        routing: { ...RUN_RESULT.routing, rationale: '' },
      }),
    ],
    ['an unlisted failure reason', agentFrame(1, 'failed', { reason: 'novel', detail: 'x' })],
    ['a payload that is not JSON', 'id: 1\nevent: started\ndata: {not json\n\n'],
    [
      'an extra field on a failure',
      agentFrame(1, 'failed', { reason: 'internal_error', detail: 'x', upstream: 'policy' }),
    ],
  ])('ends the stream with an id-less invalid_stream failure: %s', async (_name, frame) => {
    const frames = await relayed([agentFrame(1, 'started', {}), frame.replace('id: 1', 'id: 2')]);

    expect(frames.map((entry) => entry.event)).toEqual(['started', 'failed']);
    const [, notice] = frames;
    expect(notice?.id).toBeUndefined();
    expect((JSON.parse(notice?.data ?? '') as { reason: string }).reason).toBe('invalid_stream');
    expect(loggerError).toHaveBeenCalledOnce();
  });

  it('never relays the refused payload itself', async () => {
    const text = await textOf(
      relayRunEvents(
        streamOf([
          agentFrame(1, 'failed', {
            reason: 'internal_error',
            detail: 'x',
            upstream: 'policy runs_select_own',
          }),
        ]),
        RUN_ID,
      ),
    );
    expect(text).not.toContain('runs_select_own');
  });
});
