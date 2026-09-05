'use client';

import { cn } from '@artloupe/fascia/lib/utils';
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { OverlayPoint } from './overlay-geometry';
import { pointFromClientPosition } from './overlay-geometry';

/** The handle currently armed for placement — its id, and its name so the canvas can say so. */
export interface ArmedHandle {
  id: string;
  name: string;
}

interface OverlayCanvasContextValue {
  /** The measured box, for converting a pointer position into normalized coordinates. */
  canvasRef: RefObject<HTMLDivElement | null>;
  armedHandle: ArmedHandle | null;
  setArmedHandle: (handle: ArmedHandle | null) => void;
  /** Announce a change to assistive technology through the canvas's shared live region. */
  announce: (message: string) => void;
  /** Id of the shared instructions paragraph, for each handle's `aria-describedby`. */
  instructionsId: string;
}

const OverlayCanvasContext = createContext<OverlayCanvasContextValue | null>(null);

/**
 * Read the canvas a handle is drawn on. Throws rather than degrading, because a handle
 * rendered outside a canvas has no coordinate space and would silently place itself at the
 * origin on first interaction.
 */
export const useOverlayCanvas = (): OverlayCanvasContextValue => {
  const context = useContext(OverlayCanvasContext);
  if (context === null) {
    throw new Error('Overlay handles and guides must be rendered inside an <OverlayCanvas>.');
  }
  return context;
};

export interface OverlayCanvasLabels {
  /** Names the overlay group, e.g. "Head construction guides". */
  groupLabel: string;
  /**
   * How to operate the guides, referenced by every handle through `aria-describedby`.
   * Supplied by the consumer because it is user-facing copy and fascia holds none.
   */
  instructions: string;
  /** Announced when a handle is armed, e.g. "{name} armed. Click the photograph to place it." */
  armedAnnouncement: (handleName: string) => string;
  /** Names the placement target while a handle is armed, e.g. "Place {name} on the photograph". */
  placementTargetLabel: (handleName: string) => string;
}

interface OverlayCanvasProps {
  /**
   * The photograph the guides sit over. Rendered as a child rather than from a `src` prop so
   * the consumer keeps control of how the image is loaded — the read-through image route, a
   * fixture, or a Next `<Image>` — none of which fascia should know about.
   */
  children: ReactNode;
  /** The guides themselves. Drawn above the image, inside the same coordinate box. */
  overlay: ReactNode;
  labels: OverlayCanvasLabels;
  className?: string;
  /**
   * Called when an armed handle is placed by a single click on the photograph. The canvas owns
   * this rather than each handle because the click lands on the canvas, not the handle — that
   * is what makes it a *non-dragging* interaction.
   */
  onPlaceArmedHandle?: (handleId: string, point: OverlayPoint) => void;
}

/**
 * The positioned box a photograph and its guides share.
 *
 * Everything inside is laid out in the normalized space `overlay-geometry.ts` defines, so a
 * handle at `{ x: 0.5, y: 0.5 }` sits at the centre of the *image*, whatever size the layout
 * gives it.
 *
 * **Why the canvas owns tap-to-place.** WCAG 2.2 SC 2.5.7 (Dragging Movements) requires that
 * anything operable by dragging also be operable by a single pointer without dragging. Arrow
 * keys satisfy keyboard users but not SC 2.5.7, which is about pointers — a switch or
 * head-pointer user can click but cannot hold-and-move. So a handle is *armed* by clicking it,
 * after which a single click on the photograph places it. The canvas mediates that because the
 * second click lands here, and a handle cannot listen for a click it never receives.
 *
 * **Why the placement target is a real `<button>` that exists only while armed.** The obvious
 * implementation is an `onClick` on the wrapper div, and it is wrong: a click handler on a
 * non-interactive element is invisible to assistive technology and unreachable by keyboard.
 * While a handle is armed the photograph genuinely *is* a control — "place the jaw landmark
 * here" — so it is rendered as a button that says so, and disappears when nothing is armed
 * rather than sitting in the tab order announcing nothing.
 *
 * **Why one live region rather than one per handle.** Ten handles would mean ten polite
 * regions, which screen readers announce in an order no user can predict. One region owned by
 * the canvas means one queue.
 */
export const OverlayCanvas = ({
  children,
  overlay,
  labels,
  className,
  onPlaceArmedHandle,
}: OverlayCanvasProps) => {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // Generated, not a constant: two canvases on one page would otherwise both claim the same
  // id, and every handle's `aria-describedby` would resolve to whichever rendered first.
  const instructionsId = `${useId()}-overlay-instructions`;
  const [armedHandle, setArmedHandle] = useState<ArmedHandle | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const announce = useCallback((message: string) => {
    // Re-announce an identical message by clearing first: a live region whose text is
    // unchanged is not re-read, so nudging twice in the same direction would go silent.
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  const handlePlacementClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (armedHandle === null || onPlaceArmedHandle === undefined) {
        return;
      }
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect === undefined) {
        return;
      }
      onPlaceArmedHandle(
        armedHandle.id,
        pointFromClientPosition(event.clientX, event.clientY, rect),
      );
      setArmedHandle(null);
    },
    [armedHandle, onPlaceArmedHandle],
  );

  const contextValue = useMemo<OverlayCanvasContextValue>(
    () => ({ canvasRef, armedHandle, setArmedHandle, announce, instructionsId }),
    [armedHandle, announce, instructionsId],
  );

  return (
    <OverlayCanvasContext.Provider value={contextValue}>
      <div className={cn('relative', className)} data-slot="overlay-canvas-root">
        <div ref={canvasRef} className="relative overflow-hidden" data-slot="overlay-canvas">
          {children}

          {armedHandle !== null && (
            /*
              Above the image so it receives the placement click, below the guides so the armed
              handle can still be clicked again to disarm. Keyboard users never need this
              button — their path is the arrow keys — but it is a real button rather than a div,
              so it is announced, focusable, and operable if they do reach it.
            */
            <button
              aria-label={labels.placementTargetLabel(armedHandle.name)}
              className="absolute inset-0 z-10 cursor-crosshair"
              data-slot="overlay-placement-target"
              onClick={handlePlacementClick}
              type="button"
            />
          )}

          <div
            aria-label={labels.groupLabel}
            className="absolute inset-0 z-20"
            data-slot="overlay-layer"
            role="group"
          >
            {overlay}
          </div>
        </div>

        <p className="sr-only" data-slot="overlay-instructions" id={instructionsId}>
          {labels.instructions}
        </p>
        <output aria-live="polite" className="sr-only" data-slot="overlay-announcer">
          {announcement}
        </output>
      </div>
    </OverlayCanvasContext.Provider>
  );
};
