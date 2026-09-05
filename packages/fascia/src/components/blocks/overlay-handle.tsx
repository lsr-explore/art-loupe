'use client';

import { cn } from '@artloupe/fascia/lib/utils';
import { type KeyboardEvent, type PointerEvent, useCallback, useId, useRef } from 'react';
import { useOverlayCanvas } from './overlay-canvas';
import {
  clampPoint,
  describePoint,
  MIN_TARGET_PX,
  NUDGE_COARSE,
  NUDGE_FINE,
  type OverlayPoint,
  type OverlayStatus,
  pointFromClientPosition,
  toPercent,
} from './overlay-geometry';

export interface OverlayHandleLabels {
  /**
   * Names the guide — "Jaw landmark", "Left vanishing point". Becomes the base of the
   * accessible name, which the component completes with the current position.
   */
  name: string;
  /**
   * Renders the full accessible name from the guide's name, position and status. The consumer
   * owns it because word order and the status wording are both locale-dependent, and fascia
   * holds no copy.
   */
  describeHandle: (parts: {
    name: string;
    xPercent: number;
    yPercent: number;
    status: OverlayStatus;
  }) => string;
  /** Announced after a keyboard nudge or a placement. */
  announceMove: (parts: { name: string; xPercent: number; yPercent: number }) => string;
}

interface OverlayHandleProps {
  /** Stable across renders — the canvas uses it to know which handle is armed. */
  id: string;
  point: OverlayPoint;
  status: OverlayStatus;
  labels: OverlayHandleLabels;
  /**
   * Fires for every movement, from any input path. The parent owns the position; this
   * component never holds a second copy, so a rejected or clamped correction cannot leave the
   * dot somewhere the persisted value is not.
   */
  onMove: (point: OverlayPoint) => void;
  className?: string;
  /** A guide the artist may look at but not correct — an abstained feature under FR-406. */
  disabled?: boolean;
  /**
   * Announced when this handle is armed. Lives on the canvas's label bundle because the
   * sentence is about the canvas ("click the photograph"), and is threaded through here so the
   * handle that knows its own name can fill it in.
   */
  armedAnnouncement: (handleName: string) => string;
}

const STATUS_STYLES: Record<OverlayStatus, string> = {
  // Dashed and dimmer: a proposal is the agent's guess, and it backs no measured claim until
  // the artist confirms or adjusts it. Looking provisional is the honest rendering.
  proposed: 'border-dashed border-amber-500 bg-amber-500/20',
  confirmed: 'border-solid border-emerald-600 bg-emerald-600/25',
  adjusted: 'border-solid border-sky-600 bg-sky-600/25',
};

/**
 * A draggable point on an {@link OverlayCanvas} — a landmark, a horizon end, a vanishing point.
 *
 * Three input paths reach the same `onMove`, and each exists for a different reason:
 *
 * - **Pointer drag.** The obvious one, and the one the design docs describe the artist using.
 * - **Arrow keys.** SC 2.1.1 (Keyboard). Shift takes a coarse step so crossing the photograph
 *   does not take a hundred presses.
 * - **Arm, then click.** SC 2.5.7 (Dragging Movements) requires a single-pointer path that
 *   involves no dragging, which arrow keys do *not* satisfy — a switch or head-pointer user
 *   operates a pointer but cannot hold and move it. Clicking the handle arms it; the next
 *   click on the canvas places it there.
 *
 * **Why a `<button>` rather than `role="slider"`.** A slider is one-dimensional, and ARIA has
 * no two-dimensional equivalent — `aria-valuenow` cannot express a point. A button that
 * carries its coordinates in its accessible name and announces movement through the canvas's
 * live region tells a screen-reader user both where the guide is and that it moved, without
 * claiming a role whose contract this cannot meet.
 *
 * **Why the visual dot and the hit target are different sizes.** SC 2.5.8 requires a 24×24 CSS
 * px target. A 24 px dot on a face landmark would cover the feature being corrected, so the
 * button is {@link MIN_TARGET_PX} square and mostly transparent, with a smaller dot drawn at
 * its centre.
 */
export const OverlayHandle = ({
  id,
  point,
  status,
  labels,
  onMove,
  className,
  disabled = false,
  armedAnnouncement,
}: OverlayHandleProps) => {
  const { canvasRef, armedHandle, setArmedHandle, announce, instructionsId } = useOverlayCanvas();
  const buttonId = useId();
  // Captured once per drag. Re-reading the rect on every `pointermove` is both slower and
  // wrong the moment the page scrolls mid-drag.
  const dragRect = useRef<DOMRect | null>(null);
  const isArmed = armedHandle?.id === id;
  const { xPercent, yPercent } = describePoint(point);

  const moveAndAnnounce = useCallback(
    (next: OverlayPoint) => {
      const clamped = clampPoint(next);
      onMove(clamped);
      const described = describePoint(clamped);
      announce(
        labels.announceMove({
          name: labels.name,
          xPercent: described.xPercent,
          yPercent: described.yPercent,
        }),
      );
    },
    [announce, labels, onMove],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) {
        return;
      }
      const step = event.shiftKey ? NUDGE_COARSE : NUDGE_FINE;
      const deltas: Record<string, OverlayPoint> = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      };
      const delta = deltas[event.key];
      if (delta === undefined) {
        return;
      }
      // Arrow keys scroll the page by default, which would move the photograph out from under
      // the guide being adjusted.
      event.preventDefault();
      moveAndAnnounce({ x: point.x + delta.x, y: point.y + delta.y });
    },
    [disabled, moveAndAnnounce, point],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (disabled) {
        return;
      }
      // Pointer capture keeps events coming to this element once the pointer leaves it, so a
      // fast drag does not drop the guide the moment the cursor outruns a 24 px box.
      // Optional-called: jsdom implements no capture API, and an unguarded call would make
      // every drag test throw on a method the real browsers all have.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragRect.current = canvasRef.current?.getBoundingClientRect() ?? null;
    },
    [canvasRef, disabled],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const rect = dragRect.current;
      if (rect === null || disabled) {
        return;
      }
      onMove(pointFromClientPosition(event.clientX, event.clientY, rect));
    },
    [disabled, onMove],
  );

  const endDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (dragRect.current === null) {
        return;
      }
      dragRect.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
      const described = describePoint(point);
      announce(
        labels.announceMove({
          name: labels.name,
          xPercent: described.xPercent,
          yPercent: described.yPercent,
        }),
      );
    },
    [announce, labels, point],
  );

  const handleClick = useCallback(() => {
    if (disabled) {
      return;
    }
    // A click that concludes a drag must not also arm the handle, or every drag would leave it
    // waiting to teleport on the user's next click anywhere on the photograph.
    if (dragRect.current !== null) {
      return;
    }
    if (isArmed) {
      setArmedHandle(null);
      return;
    }
    setArmedHandle({ id, name: labels.name });
    // Arming changes what the next click does, which is invisible to a screen-reader user
    // otherwise — the crosshair cursor is the only other signal, and it is purely visual.
    announce(armedAnnouncement(labels.name));
  }, [announce, armedAnnouncement, disabled, id, isArmed, labels.name, setArmedHandle]);

  return (
    <button
      aria-describedby={instructionsId}
      aria-label={labels.describeHandle({ name: labels.name, xPercent, yPercent, status })}
      aria-pressed={isArmed}
      className={cn(
        'absolute flex items-center justify-center rounded-full border-2',
        '-translate-x-1/2 -translate-y-1/2 touch-none',
        // The ring sits outside the element so it is never clipped by the dot itself —
        // SC 2.4.11 (Focus Not Obscured) in the case where a guide sits at the image edge.
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        STATUS_STYLES[status],
        isArmed && 'ring-2 ring-offset-1 ring-ring',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing',
        className,
      )}
      data-armed={isArmed || undefined}
      data-slot="overlay-handle"
      data-status={status}
      disabled={disabled}
      id={buttonId}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={endDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      style={{
        ...toPercent(point),
        width: `${MIN_TARGET_PX}px`,
        height: `${MIN_TARGET_PX}px`,
      }}
      type="button"
    >
      {/* Drawn small so it marks the feature rather than hiding it; the button around it
          carries the 24 px target. `pointer-events-none` keeps the dot from becoming the
          event target and reporting its own tiny box as the drag origin. */}
      <span
        aria-hidden="true"
        className="pointer-events-none block size-2 rounded-full bg-current"
        data-slot="overlay-handle-dot"
      />
    </button>
  );
};
