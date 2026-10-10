'use client';

/**
 * Start a run of this project, then follow it until it ends.
 *
 * The run starts only when the artist asks: a run spends Director tokens, so arriving on the page
 * never starts one. When the page already knows of a run, the panel follows it at once, and the
 * stream replays every event from the start, so a reload shows the same steps and the same result.
 *
 * Progress is announced through a polite live region: the current step, then the outcome. The
 * step list itself is not live, or a screen reader would read every update twice.
 */
import { Alert, AlertDescription, AlertTitle } from '@artloupe/fascia/components/ui/alert';
import { Button } from '@artloupe/fascia/components/ui/button';
import { useTranslations } from 'next-intl';
import { useEffect, useReducer, useState } from 'react';

import {
  RUN_EVENT_KINDS,
  RUN_NODES,
  runEventsEndpoint,
  runsEndpoint,
  type RunEvent,
  type StartRunResponse,
} from '@/lib/runs/run-contract';

import { PlanSummary } from './plan-summary';
import { RoutingSummary } from './routing-summary';
import { IDLE, applyInvalidStream, applyRunEvent, following, type RunView } from './run-view';

type Action =
  | { type: 'event'; event: RunEvent }
  | { type: 'invalid_stream' }
  | { type: 'starting' }
  | { type: 'start_failed' }
  | { type: 'follow'; runId: string }
  | { type: 'disconnected' };

const reduce = (view: RunView, action: Action): RunView => {
  switch (action.type) {
    case 'event':
      return applyRunEvent(view, action.event);
    case 'invalid_stream':
      return applyInvalidStream(view);
    case 'starting':
      return { ...IDLE, phase: 'starting' };
    case 'start_failed':
      return { ...IDLE, phase: 'start_failed' };
    case 'follow':
      return following(action.runId);
    case 'disconnected':
      return view.phase === 'running' ? { ...view, phase: 'disconnected' } : view;
  }
};

/** Order the steps the way the graph runs them; anything unknown follows, so it still shows. */
const ordered = (nodes: RunView['nodes']) => {
  const rank = (node: string) => {
    const index = (RUN_NODES as readonly string[]).indexOf(node);
    return index === -1 ? RUN_NODES.length : index;
  };
  return [...nodes].sort((first, second) => rank(first.node) - rank(second.node));
};

interface RunPanelProps {
  projectId: string;
  /** The project's latest run, if the page found one. */
  initialRunId: string | null;
}

export const RunPanel = ({ projectId, initialRunId }: RunPanelProps) => {
  const tr = useTranslations('project.run');
  const tn = useTranslations('project.nodes');
  const tf = useTranslations('project.failure');
  const [view, dispatch] = useReducer(reduce, initialRunId, (runId) =>
    runId === null ? IDLE : following(runId),
  );
  const [runId, setRunId] = useState(initialRunId);

  useEffect(() => {
    if (runId === null) return undefined;
    const source = new EventSource(runEventsEndpoint(runId));
    let finished = false;

    const onEvent = (message: MessageEvent<string>) => {
      let payload: unknown;
      try {
        payload = JSON.parse(message.data);
      } catch {
        payload = undefined;
      }
      // An event without an id is the studio's own `invalid_stream` notice.
      if (message.lastEventId === '' && message.type === 'failed') {
        finished = true;
        source.close();
        dispatch({ type: 'invalid_stream' });
        return;
      }
      // The route handler validated this event against the contract before sending it.
      const event = { seq: Number(message.lastEventId), kind: message.type, payload } as RunEvent;
      dispatch({ type: 'event', event });
      if (event.kind === 'succeeded' || event.kind === 'failed') {
        finished = true;
        source.close();
      }
    };

    for (const kind of RUN_EVENT_KINDS) {
      source.addEventListener(kind, onEvent as EventListener);
    }
    // `EventSource` reconnects by itself after a dropped connection. It gives up only when the
    // server refuses the stream outright, which leaves it CLOSED.
    source.onerror = () => {
      if (!finished && source.readyState === EventSource.CLOSED) {
        dispatch({ type: 'disconnected' });
      }
    };

    return () => {
      finished = true;
      source.close();
    };
  }, [runId]);

  const start = async () => {
    dispatch({ type: 'starting' });
    try {
      const response = await fetch(runsEndpoint(projectId), { method: 'POST' });
      if (response.status !== 202) {
        dispatch({ type: 'start_failed' });
        return;
      }
      const body = (await response.json()) as StartRunResponse;
      dispatch({ type: 'follow', runId: body.runId });
      setRunId(body.runId);
    } catch {
      dispatch({ type: 'start_failed' });
    }
  };

  // Explicit start only. Offered again after a failure, so a failed run is not a dead end.
  const canStart =
    view.phase === 'idle' || view.phase === 'failed' || view.phase === 'start_failed';
  const nodeName = (node: string) => (tn.has(node) ? tn(node) : node);
  const current = [...view.nodes].reverse().find((entry) => entry.status === 'running');

  const announcement = (() => {
    switch (view.phase) {
      case 'starting':
        return tr('starting');
      case 'running':
        return current ? tr('runningStep', { step: nodeName(current.node) }) : tr('queued');
      case 'succeeded':
        return tr('succeeded');
      case 'failed':
        return tr('failed');
      case 'disconnected':
        return tr('disconnected');
      case 'start_failed':
        return tr('startFailed');
      default:
        return '';
    }
  })();

  return (
    <section aria-labelledby="run-heading" className="flex flex-col gap-4">
      <h2 id="run-heading" className="text-lg font-semibold">
        {tr('title')}
      </h2>

      {/* `<output>` carries the status role natively; `aria-live` is restated for older AT. */}
      <output aria-live="polite" className="text-sm text-muted-foreground">
        {announcement}
      </output>

      {canStart ? (
        <div>
          <Button type="button" onClick={start}>
            {view.phase === 'idle' ? tr('start') : tr('retry')}
          </Button>
        </div>
      ) : null}

      {view.nodes.length > 0 ? (
        <ol aria-label={tr('stepsLabel')} className="flex flex-col gap-1 text-sm">
          {ordered(view.nodes).map((entry) => (
            <li key={entry.node}>
              <span>{nodeName(entry.node)}</span>
              <span className="text-muted-foreground">
                {' '}
                — {entry.status === 'done' ? tr('stepDone') : tr('stepRunning')}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {view.phase === 'failed' && view.failure ? (
        <Alert variant="destructive">
          <AlertTitle>{tr('failedTitle')}</AlertTitle>
          <AlertDescription>{tf(view.failure.reason)}</AlertDescription>
        </Alert>
      ) : null}

      {view.phase === 'disconnected' ? (
        <Alert>
          <AlertTitle>{tr('disconnectedTitle')}</AlertTitle>
          <AlertDescription>{tr('disconnectedHint')}</AlertDescription>
        </Alert>
      ) : null}

      {view.phase === 'start_failed' ? (
        <Alert variant="destructive">
          <AlertTitle>{tr('startFailedTitle')}</AlertTitle>
          <AlertDescription>{tr('startFailedHint')}</AlertDescription>
        </Alert>
      ) : null}

      {view.result ? <RoutingSummary routing={view.result.routing} /> : null}

      {/* A run recorded before plans existed has none; it still shows its routing. */}
      {view.result?.plan ? <PlanSummary outcome={view.result.plan} /> : null}
    </section>
  );
};
