import 'server-only';
/**
 * Relay the agent's run stream to the browser, validating every event on the way.
 *
 * The agent's stream is not passed through byte for byte. Each frame is parsed, its payload is
 * checked against `runEventSchema`, and only then is it written out again. That is the stream
 * form of "never render a decision that has not been validated", and it keeps Zod on the server:
 * the browser receives events this process has already vouched for.
 *
 * A frame the contract refuses ends the stream with a studio-made `failed` event whose reason is
 * `invalid_stream`. It carries no id, so the client's cursor does not move past the last event it
 * could trust. Heartbeats are passed on, so the browser's connection survives the same proxies
 * the agent's does.
 */
import { runEventSchema } from '@artloupe/schemas';

import { logger } from '@/lib/logger';

import { INVALID_STREAM_REASON } from './run-contract';
import { formatSseFrame, readSseFrames, type SseFrame } from './sse';

/** How long `EventSource` waits before reconnecting, in milliseconds. Matches the agent's. */
const RETRY_MILLISECONDS = 1000;

const TERMINAL = new Set(['succeeded', 'failed']);

const invalidStream = (): string =>
  formatSseFrame({
    event: 'failed',
    data: JSON.stringify({
      reason: INVALID_STREAM_REASON,
      detail: 'The analysis service sent an update that could not be read.',
    }),
  });

export const relayRunEvents = (
  upstream: ReadableStream<Uint8Array>,
  runId: string,
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const frames = readSseFrames(upstream);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`retry: ${RETRY_MILLISECONDS}\n\n`));
    },
    async pull(controller) {
      let next: IteratorResult<SseFrame>;
      try {
        next = await frames.next();
      } catch {
        // The agent's connection dropped. Closing lets `EventSource` reconnect from its cursor.
        controller.close();
        return;
      }
      if (next.done) {
        controller.close();
        return;
      }
      const frame = next.value;
      if (frame.comment) {
        controller.enqueue(encoder.encode(': keepalive\n\n'));
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(frame.data ?? '');
      } catch {
        payload = undefined;
      }
      const parsed = runEventSchema.safeParse({
        seq: Number(frame.id),
        kind: frame.event,
        payload,
      });
      if (!parsed.success) {
        logger.error(
          { runId, event: frame.event, issues: parsed.error.issues.length },
          'agent run stream sent an event the contract refuses',
        );
        controller.enqueue(encoder.encode(invalidStream()));
        controller.close();
        await frames.return(undefined);
        return;
      }

      const event = parsed.data;
      controller.enqueue(
        encoder.encode(
          formatSseFrame({
            id: String(event.seq),
            event: event.kind,
            data: JSON.stringify(event.payload),
          }),
        ),
      );
      if (TERMINAL.has(event.kind)) {
        controller.close();
        await frames.return(undefined);
      }
    },
    async cancel() {
      // The browser went away. Releasing the reader lets the upstream fetch be aborted.
      await frames.return(undefined);
    },
  });
};
