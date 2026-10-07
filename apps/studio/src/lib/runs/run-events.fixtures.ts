/**
 * Run events as the agent sends them, shared by the relay, route and panel tests.
 *
 * The routing decision is the parity fixture's portrait, so a change to the contract that breaks
 * it breaks these tests too.
 */
import type { RunResult } from './run-contract';

export const RUN_ID = '7d1f3a2c-5b6e-4c8d-9e0f-1a2b3c4d5e6f';
export const PROJECT_ID = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';

export const RUN_RESULT: RunResult = {
  run_id: RUN_ID,
  owner: '4a1f0e2c-0000-4000-8000-000000000001',
  project_id: PROJECT_ID,
  node_trail: ['load_project', 'face_gate', 'survey', 'direct', 'analyse'],
  gate: { face_found: true, reason: null },
  routing: {
    manifest: {
      selected: [
        { tool: 'grayscale', reason: null },
        { tool: 'value_map', reason: 'low-key reference; the value design is the whole problem' },
        {
          tool: 'head_construction',
          reason: 'one face, with a facial landmark reliability of 0.8',
        },
      ],
      declined: [
        {
          tool: 'perspective',
          reason: 'no vanishing point cleared the 0.35 confidence floor',
        },
      ],
    },
    rationale:
      'This is a portrait with one clearly detected face, so the head construction is worth building.',
    gate: { face_found: true, reason: null },
  },
  artifacts: [],
};

/** One SSE frame, in the agent's own framing. */
export const agentFrame = (seq: number, kind: string, payload: unknown): string =>
  `id: ${seq}\nevent: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`;

/** A whole successful run, as the agent streams it. */
export const SUCCESSFUL_RUN = [
  'retry: 1000\n\n',
  agentFrame(1, 'started', {}),
  agentFrame(2, 'node_started', { node: 'load_project' }),
  ': keepalive\n\n',
  agentFrame(3, 'node_finished', { node: 'load_project' }),
  agentFrame(4, 'succeeded', RUN_RESULT),
];

/** A byte stream that delivers `chunks` one at a time, as a network would. */
export const streamOf = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
};

/** Read a whole stream back as text. */
export const textOf = async (stream: ReadableStream<Uint8Array>): Promise<string> =>
  new Response(stream).text();
