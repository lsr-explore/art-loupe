import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { OverlayCanvas } from './overlay-canvas';
import type { OverlayPoint } from './overlay-geometry';
import { OverlayHandle } from './overlay-handle';
import { canvasLabels, FixturePhotograph, handleLabels } from './overlay-test-fixtures';

const CANVAS_RECT = { left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 };

/**
 * jsdom lays nothing out, so every element measures zero. The placement path converts a click
 * position against the canvas box, which without this would divide by zero — the geometry
 * guards that to the origin, and every placement assertion would pass for the wrong reason.
 */
const stubCanvasRect = () => {
  const canvas = document.querySelector('[data-slot="overlay-canvas"]');
  if (canvas === null) {
    throw new Error('no canvas rendered');
  }
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    ...CANVAS_RECT,
    x: 0,
    y: 0,
    toJSON: () => CANVAS_RECT,
  } as DOMRect);
  return canvas;
};

/**
 * The guide handle. Anchored to the start of the name because the placement target is
 * "Place Jaw landmark on the photograph" — a loose /Jaw landmark/ matches both once armed.
 */
const getHandle = () => screen.getByRole('button', { name: /^Jaw landmark,/ });

/** The placement target, which exists only while a handle is armed. */
const getPlacementTarget = () =>
  screen.getByRole('button', { name: 'Place Jaw landmark on the photograph' });

const CanvasHarness = ({ onPlace }: { onPlace?: (point: OverlayPoint) => void }) => {
  const [point, setPoint] = useState<OverlayPoint>({ x: 0.5, y: 0.5 });
  return (
    <OverlayCanvas
      labels={canvasLabels}
      onPlaceArmedHandle={(_handleId, placed) => {
        setPoint(placed);
        onPlace?.(placed);
      }}
      overlay={
        <OverlayHandle
          armedAnnouncement={canvasLabels.armedAnnouncement}
          id="jaw"
          labels={handleLabels}
          onMove={setPoint}
          point={point}
          status="proposed"
        />
      }
    >
      <FixturePhotograph />
    </OverlayCanvas>
  );
};

// @trace flow=analysis.geometry category=functionality
describe('OverlayCanvas', () => {
  it('renders the photograph and groups the guides over it', () => {
    render(<CanvasHarness />);

    expect(screen.getByRole('img', { name: 'Reference photograph' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: canvasLabels.groupLabel })).toBeInTheDocument();
  });

  it('places an armed handle where the photograph is clicked, without a drag', () => {
    const onPlace = vi.fn();
    render(<CanvasHarness onPlace={onPlace} />);
    stubCanvasRect();

    act(() => {
      fireEvent.click(getHandle());
    });
    act(() => {
      fireEvent.click(getPlacementTarget(), { clientX: 100, clientY: 150 });
    });

    // 100/400 across, 150/200 down. This is the whole SC 2.5.7 path: two ordinary clicks,
    // no press-and-hold anywhere.
    expect(onPlace).toHaveBeenCalledWith({ x: 0.25, y: 0.75 });
  });

  it('offers no placement target until a handle is armed', () => {
    render(<CanvasHarness />);

    // A permanent full-canvas button would sit in the tab order announcing an action that is
    // not available, which is worse than not being there.
    expect(
      screen.queryByRole('button', { name: 'Place Jaw landmark on the photograph' }),
    ).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(getHandle());
    });

    expect(getPlacementTarget()).toBeInTheDocument();
  });

  it('disarms after placing, so the target is gone before the next click', () => {
    const onPlace = vi.fn();
    render(<CanvasHarness onPlace={onPlace} />);
    stubCanvasRect();

    act(() => {
      fireEvent.click(getHandle());
    });
    const target = getPlacementTarget();
    act(() => {
      fireEvent.click(target, { clientX: 100, clientY: 150 });
    });

    // The target unmounting IS the disarm: a stray second click cannot land on it, so no
    // guide can be moved by a click the artist did not aim at it.
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(target).not.toBeInTheDocument();
    expect(getHandle()).toHaveAttribute('aria-pressed', 'false');
  });

  it('throws a useful error when a handle is rendered outside a canvas', () => {
    // Failing loudly beats the alternative: a handle with no coordinate space silently places
    // itself at the origin the first time it is touched.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      render(
        <OverlayHandle
          armedAnnouncement={canvasLabels.armedAnnouncement}
          id="orphan"
          labels={handleLabels}
          onMove={vi.fn()}
          point={{ x: 0.5, y: 0.5 }}
          status="proposed"
        />,
      ),
    ).toThrow(/must be rendered inside an <OverlayCanvas>/);

    consoleError.mockRestore();
  });

  it('does not let the guide layer swallow the placement click', () => {
    render(<CanvasHarness />);
    act(() => {
      fireEvent.click(getHandle());
    });

    // The layer spans the whole canvas *above* the placement button. jsdom does no
    // hit-testing, so firing a click straight at the button — which every other test here
    // does — cannot catch this; the invariant has to be asserted on the DOM instead.
    // Without `pointer-events-none` the real browser routes the click to a div with no
    // handler and the SC 2.5.7 path silently does nothing.
    const layer = document.querySelector('[data-slot="overlay-layer"]');
    expect(layer).toHaveClass('pointer-events-none');
    expect(getHandle()).toHaveClass('pointer-events-auto');
  });

  // @trace category=a11y
  it('announces a move through one polite live region', async () => {
    render(<CanvasHarness />);

    act(() => {
      fireEvent.keyDown(getHandle(), { key: 'ArrowRight', shiftKey: true });
    });

    // One region for the whole canvas, not one per handle: ten simultaneous polite regions
    // are announced in an order no user can predict.
    const announcer = document.querySelector('[data-slot="overlay-announcer"]');
    expect(announcer).toHaveAttribute('aria-live', 'polite');
    await waitFor(() =>
      expect(announcer).toHaveTextContent('Jaw landmark moved to 52% across, 50% down.'),
    );
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = render(<CanvasHarness />);

    expect(await axe(container)).toHaveNoViolations();
  });

  // @trace category=a11y
  it('gives each canvas its own instructions id', () => {
    render(
      <>
        <CanvasHarness />
        <CanvasHarness />
      </>,
    );

    // Two canvases on one page must not both claim the same id, or every handle's
    // `aria-describedby` resolves to whichever rendered first.
    const [first, second] = screen.getAllByRole('button', { name: /^Jaw landmark,/ });
    expect(first.getAttribute('aria-describedby')).not.toBe(
      second.getAttribute('aria-describedby'),
    );
  });
});
