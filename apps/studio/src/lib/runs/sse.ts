/**
 * Server-Sent Events framing: reading frames from a byte stream, and writing them.
 *
 * Small and spec-shaped on purpose (WHATWG HTML, "Server-sent events" §9.2.6). Only the fields
 * this app uses are kept — `id`, `event`, `data` — plus whether the frame was a comment, so a
 * heartbeat can be passed on. `retry` lines are dropped: the relay sends its own.
 */

export interface SseFrame {
  id?: string;
  event?: string;
  data?: string;
  /** True for a frame made only of comment lines, such as the agent's `: keepalive`. */
  comment?: boolean;
}

const parseBlock = (block: string): SseFrame | null => {
  const frame: SseFrame = {};
  const data: string[] = [];
  let sawField = false;
  let sawComment = false;
  for (const line of block.split(/\r\n|\r|\n/)) {
    if (line === '') continue;
    if (line.startsWith(':')) {
      sawComment = true;
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'id') frame.id = value;
    else if (field === 'event') frame.event = value;
    else if (field === 'data') data.push(value);
    else continue;
    sawField = true;
  }
  if (data.length > 0) frame.data = data.join('\n');
  if (sawField) return frame;
  return sawComment ? { comment: true } : null;
};

/** Yield each complete frame in `stream`. A trailing partial frame is discarded, per the spec. */
export const readSseFrames = async function* (
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = '';
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        finished = true;
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r\n\r\n|\n\n|\r\r/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const frame = parseBlock(block);
        if (frame !== null) yield frame;
      }
    }
  } finally {
    // Stopped before the end: the caller returned early or threw. Releasing the lock alone would
    // leave the upstream stream open, and the agent would keep polling it until its own limit.
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

/** One frame in wire form. `data` is a single line here: every payload is compact JSON. */
export const formatSseFrame = ({ id, event, data }: SseFrame): string =>
  `${id === undefined ? '' : `id: ${id}\n`}${event === undefined ? '' : `event: ${event}\n`}data: ${data ?? ''}\n\n`;
