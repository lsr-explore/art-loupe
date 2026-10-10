/**
 * Run events as the agent sends them, shared by the relay, route and panel tests.
 *
 * The routing decision is the parity fixture's portrait, so a change to the contract that breaks
 * it breaks these tests too. `RUN_RESULT` has no plan, as a run recorded before the plan half of
 * the graph existed; `PLANNED_RUN_RESULT` carries one, revised once.
 */
import type { PlanOutcome, RunResult } from './run-contract';

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

const CHECKSUM = '9f2c4a1b7e6d5038c9b2a1f4e7d60359a8b1c2d3e4f5061728394a5b6c7d8e9f';

const MEASURED = {
  kind: 'measured',
  tool: 'value_map',
  tool_version: '0.1.0',
  parameters: { values: 5 },
  source_checksum: CHECKSUM,
  units: 'normalized',
} as const;

const CITED = {
  kind: 'cited',
  chunk_id: 'fx-oil-materials',
  institution: 'Art Loupe fixture lessons',
  url: 'https://example.invalid/fixture-lessons/fx-oil-materials',
  licence: 'Fixture text written for development. Not a published source.',
  retrieved_at: '2026-10-09T00:00:00Z',
  passage_span: { start: 0, end: 40 },
} as const;

const TIMEBOX_DEFECT = {
  category: 'infeasible_timebox',
  detail: 'The stages add up to 60 minutes against a budget of 90 minutes.',
  location: null,
  origin: 'check',
} as const;

export const PLAN_OUTCOME: PlanOutcome = {
  findings: {
    findings: [
      {
        finding_id: 'value_map',
        text: 'Nearly a third of the photograph sits in the darkest value.',
        evidence: MEASURED,
      },
    ],
    set_aside: [
      {
        finding_id: 'perspective',
        reason: 'No vanishing point cleared the confidence floor, so no horizon is claimed.',
      },
    ],
  },
  lessons: [],
  plan: {
    assessment: {
      suitability: 'workable',
      claims: [
        {
          text: 'The darkest value covers nearly a third of the frame.',
          evidence: MEASURED,
          source: 'value_map',
        },
      ],
    },
    materials: [
      {
        item_id: 'filbert',
        category: 'brush',
        specification: 'a medium hog-bristle filbert',
        claim: {
          text: 'A filbert moves paint in broad masses.',
          evidence: CITED,
          source: 'fx-oil-materials',
        },
      },
    ],
    stages: [
      {
        stage_id: 'block-in',
        title: 'Block in the darks',
        minutes: 60,
        goal: 'Mass the darkest value as one shape.',
        completion_signal: 'Every dark on the value plate has a mass.',
        materials: ['filbert'],
        claims: [
          {
            text: 'Start from the darkest shapes.',
            evidence: {
              kind: 'chosen',
              reason: 'the darks carry the composition',
              rejected_alternative: 'starting from the outline',
            },
            source: null,
          },
        ],
      },
      {
        stage_id: 'refine',
        title: 'Refine the edges',
        minutes: 30,
        goal: 'Sharpen the focal edges.',
        completion_signal: 'The hardest edge sits at the focal point.',
        materials: ['filbert'],
        claims: [],
      },
    ],
    self_check: ['Do the darkest shapes match the value plate?'],
  },
  verdicts: [
    {
      verdict: 'REVISE',
      defects: [TIMEBOX_DEFECT],
      summary: 'The time boxes miss the budget.',
      revision: 0,
    },
    {
      verdict: 'READY_WITH_CAUTION',
      defects: [
        {
          category: 'missing_evidence',
          detail: "The stage 'Refine the edges' rests on no finding, lesson or choice.",
          location: 'refine',
          origin: 'check',
        },
      ],
      summary: 'Usable, though the second stage rests on nothing.',
      revision: 1,
    },
  ],
};

export const PLANNED_RUN_RESULT: RunResult = {
  ...RUN_RESULT,
  node_trail: [
    ...RUN_RESULT.node_trail,
    'interpret',
    'gather_lessons',
    'plan',
    'critique',
    'plan',
    'critique',
  ],
  plan: PLAN_OUTCOME,
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
