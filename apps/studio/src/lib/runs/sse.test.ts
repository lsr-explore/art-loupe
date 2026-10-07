// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { streamOf } from './run-events.fixtures';
import { formatSseFrame, readSseFrames, type SseFrame } from './sse';

const collect = async (chunks: string[]): Promise<SseFrame[]> => {
  const frames: SseFrame[] = [];
  for await (const frame of readSseFrames(streamOf(chunks))) frames.push(frame);
  return frames;
};

// @trace flow=intake.project-intent category=functionality
describe('SSE framing', () => {
  it('reads id, event and data, and joins multi-line data', async () => {
    expect(await collect(['id: 3\nevent: started\ndata: {}\n\n', 'data: a\ndata: b\n\n'])).toEqual([
      { id: '3', event: 'started', data: '{}' },
      { data: 'a\nb' },
    ]);
  });

  it('reassembles a frame split across network chunks', async () => {
    expect(await collect(['id: 1\nev', 'ent: started\nda', 'ta: {}\n', '\n'])).toEqual([
      { id: '1', event: 'started', data: '{}' },
    ]);
  });

  it('keeps a comment-only frame as a heartbeat and drops retry lines', async () => {
    expect(await collect([': keepalive\n\n', 'retry: 1000\n\n'])).toEqual([{ comment: true }]);
  });

  it('discards a trailing partial frame, as the spec requires', async () => {
    expect(await collect(['id: 1\nevent: started\ndata: {}'])).toEqual([]);
  });

  it('writes a frame the reader reads back unchanged', async () => {
    const frame = { id: '5', event: 'node_started', data: '{"node":"survey"}' };
    expect(await collect([formatSseFrame(frame)])).toEqual([frame]);
  });
});
