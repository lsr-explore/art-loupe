/**
 * What the run panel shows, folded from the run's events.
 *
 * A pure reducer, kept apart from the component so the whole event vocabulary can be tested
 * without a DOM or an `EventSource`. Replaying a run's log from the start through `applyRunEvent`
 * rebuilds exactly the view the panel had, which is what makes a reload lossless.
 */
import type { RunEvent, RunFailureReason, RunResult } from '@/lib/runs/run-contract';
import { INVALID_STREAM_REASON } from '@/lib/runs/run-contract';

export type PanelFailureReason = RunFailureReason | typeof INVALID_STREAM_REASON;

export type RunPhase =
  /** No run yet, or none this page knows about. */
  | 'idle'
  /** The start request is in flight. */
  | 'starting'
  /** Following a run that has not finished. */
  | 'running'
  | 'succeeded'
  | 'failed'
  /** The stream closed without a final event and will not reconnect by itself. */
  | 'disconnected'
  /** The start request itself was refused or could not be sent. */
  | 'start_failed';

export interface NodeProgress {
  node: string;
  status: 'running' | 'done';
}

export interface RunView {
  phase: RunPhase;
  runId: string | null;
  nodes: NodeProgress[];
  result: RunResult | null;
  failure: { reason: PanelFailureReason } | null;
}

export const IDLE: RunView = { phase: 'idle', runId: null, nodes: [], result: null, failure: null };

/** A view for a run that is known to exist and is about to be followed from its first event. */
export const following = (runId: string): RunView => ({ ...IDLE, phase: 'running', runId });

const withNode = (nodes: NodeProgress[], node: string, status: NodeProgress['status']) =>
  nodes.some((entry) => entry.node === node)
    ? nodes.map((entry) => (entry.node === node ? { node, status } : entry))
    : [...nodes, { node, status }];

export const applyRunEvent = (view: RunView, event: RunEvent): RunView => {
  switch (event.kind) {
    case 'started':
      return { ...view, phase: 'running' };
    case 'node_started':
      return {
        ...view,
        phase: 'running',
        nodes: withNode(view.nodes, event.payload.node, 'running'),
      };
    case 'node_finished':
      return { ...view, nodes: withNode(view.nodes, event.payload.node, 'done') };
    case 'succeeded':
      return { ...view, phase: 'succeeded', result: event.payload };
    case 'failed':
      return { ...view, phase: 'failed', failure: { reason: event.payload.reason } };
  }
};

/** The studio's own `failed` event, for a stream the contract refused. */
export const applyInvalidStream = (view: RunView): RunView => ({
  ...view,
  phase: 'failed',
  failure: { reason: INVALID_STREAM_REASON },
});
