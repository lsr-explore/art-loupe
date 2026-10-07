import { describe, expect, it } from 'vitest';

import type { RunEvent } from '@/lib/runs/run-contract';
import { RUN_RESULT } from '@/lib/runs/run-events.fixtures';

import { applyInvalidStream, applyRunEvent, following, IDLE, type RunView } from './run-view';

const replay = (events: RunEvent[], from: RunView = following('run')) =>
  events.reduce(applyRunEvent, from);

// @trace flow=intake.project-intent category=functionality
describe('folding a run log into a view', () => {
  it('tracks each node from running to done', () => {
    const view = replay([
      { seq: 1, kind: 'started', payload: {} },
      { seq: 2, kind: 'node_started', payload: { node: 'load_project' } },
      { seq: 3, kind: 'node_finished', payload: { node: 'load_project' } },
      { seq: 4, kind: 'node_started', payload: { node: 'face_gate' } },
    ]);
    expect(view.phase).toBe('running');
    expect(view.nodes).toEqual([
      { node: 'load_project', status: 'done' },
      { node: 'face_gate', status: 'running' },
    ]);
  });

  it('keeps the result of a run that succeeded', () => {
    const view = replay([
      { seq: 1, kind: 'started', payload: {} },
      { seq: 2, kind: 'succeeded', payload: RUN_RESULT },
    ]);
    expect(view.phase).toBe('succeeded');
    expect(view.result).toEqual(RUN_RESULT);
  });

  it('keeps only the reason of a run that failed, never its English detail', () => {
    const view = replay([
      { seq: 1, kind: 'failed', payload: { reason: 'budget_exceeded', detail: 'spent' } },
    ]);
    expect(view).toMatchObject({ phase: 'failed', failure: { reason: 'budget_exceeded' } });
  });

  it('turns a refused stream into a failure of its own', () => {
    expect(applyInvalidStream(following('run'))).toMatchObject({
      phase: 'failed',
      failure: { reason: 'invalid_stream' },
    });
  });

  it('starts idle, with no run', () => {
    expect(IDLE).toMatchObject({ phase: 'idle', runId: null, nodes: [] });
  });
});
