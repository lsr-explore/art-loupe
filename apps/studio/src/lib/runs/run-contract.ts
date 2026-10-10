/**
 * The wire shape between the studio's run routes and the browser, in one importable place.
 *
 * Same reason as `lib/api/project-contract.ts`: the route handlers, the run panel and their tests
 * all read these names rather than restating them. **No runtime imports**, so the client bundle
 * can hold it without pulling Zod behind it. The `@artloupe/schemas` import is type-only and is
 * erased at build.
 */

import type {
  PlanClaim,
  PlanOutcome,
  RunEvent,
  RunFailureReason,
  RunResult,
} from '@artloupe/schemas';

export type { PlanClaim, PlanOutcome, RunEvent, RunFailureReason, RunResult };

/** Starts a run of one project. Not locale-prefixed: route handlers never are. */
export const runsEndpoint = (projectId: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/runs`;

/** The run's validated event stream. */
export const runEventsEndpoint = (runId: string): string =>
  `/api/runs/${encodeURIComponent(runId)}/events`;

/** The 202 body of `POST runsEndpoint(projectId)`. */
export interface StartRunResponse {
  runId: string;
}

/** Every SSE event name the stream can carry. The panel listens for exactly these. */
export const RUN_EVENT_KINDS = [
  'started',
  'node_started',
  'node_finished',
  'succeeded',
  'failed',
] as const satisfies readonly RunEvent['kind'][];

/**
 * The graph's nodes, in execution order (`python/services/agent/.../graph.py`).
 *
 * The panel shows each as a step. A node it does not know is still shown, after these, so a
 * node added in Python appears rather than vanishing. A revised plan runs `plan` and `critique`
 * twice; the panel shows each step once, with its latest status.
 */
export const RUN_NODES = [
  'load_project',
  'face_gate',
  'survey',
  'direct',
  'analyse',
  'interpret',
  'gather_lessons',
  'plan',
  'critique',
] as const;

/**
 * Sent by the studio, never by the agent, when the agent's stream carried something the
 * contract refuses. It has no id, so it never moves the client's cursor.
 */
export const INVALID_STREAM_REASON = 'invalid_stream';
