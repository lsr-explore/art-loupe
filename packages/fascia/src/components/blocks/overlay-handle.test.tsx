import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { OverlayCanvas } from './overlay-canvas';
import { MIN_TARGET_PX, type OverlayPoint, type OverlayStatus } from './overlay-geometry';
import { OverlayHandle } from './overlay-handle';
import { canvasLabels, FixturePhotograph, handleLabels } from './overlay-test-fixtures';

/**
 * The canvas plus one handle, with the parent owning the position exactly as a real page
 * would. Rendering the handle standalone would not compile — it reads its canvas through
 * context — and would also not test the thing worth testing, which is the two of them
 * cooperating on the non-dragging placement path.
 */
const HandleHarness = ({
  initial = { x: 0.5, y: 0.5 },
  status = 'proposed',
  disabled = false,
  onMove,
}: {
  initial?: OverlayPoint;
  status?: OverlayStatus;
  disabled?: boolean;
  onMove?: (point: OverlayPoint) => void;
}) => {
  const [point, setPoint] = useState(initial);
  const apply = (next: OverlayPoint) => {
    setPoint(next);
    onMove?.(next);
  };
  return (
    <OverlayCanvas
      labels={canvasLabels}
      onPlaceArmedHandle={(_handleId, placed) => apply(placed)}
      overlay={
        <OverlayHandle
          armedAnnouncement={canvasLabels.armedAnnouncement}
          disabled={disabled}
          id="jaw"
          labels={handleLabels}
          onMove={apply}
          point={point}
          status={status}
        />
      }
    >
      <FixturePhotograph />
    </OverlayCanvas>
  );
};

const pressKey = (element: HTMLElement, key: string, shiftKey = false) =>
  act(() => {
    fireEvent.keyDown(element, { key, shiftKey });
  });

// @trace flow=analysis.geometry category=functionality
describe('OverlayHandle', () => {
  it('names itself with the guide, its position, and its status', () => {
    render(<HandleHarness initial={{ x: 0.4627, y: 0.3723 }} />);

    // The position lives in the accessible name because ARIA has no two-dimensional value.
    // Without it a screen-reader user knows a jaw guide exists but not where it sits.
    expect(
      screen.getByRole('button', { name: 'Jaw landmark, 46% across, 37% down, proposed' }),
    ).toBeInTheDocument();
  });

  it('moves on arrow keys and updates its own accessible name', () => {
    render(<HandleHarness initial={{ x: 0.2, y: 0.5 }} />);
    const handle = screen.getByRole('button');

    // 0.2 + NUDGE_COARSE (0.02) = 0.22 -> 22%, so the rounded announcement actually changes.
    pressKey(handle, 'ArrowRight', true);

    expect(handle).toHaveAccessibleName('Jaw landmark, 22% across, 50% down, proposed');
  });

  it('takes a fine step by default and a coarse step with shift', () => {
    const onMove = vi.fn();
    render(<HandleHarness initial={{ x: 0.5, y: 0.5 }} onMove={onMove} />);
    const handle = screen.getByRole('button');

    pressKey(handle, 'ArrowRight');
    expect(onMove).toHaveBeenLastCalledWith({ x: 0.502, y: 0.5 });

    pressKey(handle, 'ArrowDown', true);
    expect(onMove).toHaveBeenLastCalledWith({ x: 0.502, y: 0.52 });
  });

  it('moves up and left on the corresponding arrows', () => {
    const onMove = vi.fn();
    render(<HandleHarness initial={{ x: 0.5, y: 0.5 }} onMove={onMove} />);
    const handle = screen.getByRole('button');

    pressKey(handle, 'ArrowLeft', true);
    expect(onMove).toHaveBeenLastCalledWith({ x: 0.48, y: 0.5 });

    pressKey(handle, 'ArrowUp', true);
    expect(onMove).toHaveBeenLastCalledWith({ x: 0.48, y: 0.48 });
  });

  it('clamps at the edge rather than walking off the photograph', () => {
    const onMove = vi.fn();
    render(<HandleHarness initial={{ x: 0, y: 0.5 }} onMove={onMove} />);

    pressKey(screen.getByRole('button'), 'ArrowLeft');

    expect(onMove).toHaveBeenLastCalledWith({ x: 0, y: 0.5 });
  });

  it('ignores keys it does not handle', () => {
    const onMove = vi.fn();
    render(<HandleHarness onMove={onMove} />);
    const handle = screen.getByRole('button');

    pressKey(handle, 'a');
    pressKey(handle, 'Escape');

    expect(onMove).not.toHaveBeenCalled();
  });

  it('offers a non-dragging pointer path: arm the handle, then click to place', () => {
    const onMove = vi.fn();
    render(<HandleHarness onMove={onMove} />);
    const handle = screen.getByRole('button');

    // SC 2.5.7 (Dragging Movements). Arrow keys do not satisfy it — it is about pointers, and
    // a switch or head-pointer user can click but cannot hold and move.
    expect(handle).toHaveAttribute('aria-pressed', 'false');

    act(() => {
      fireEvent.click(handle);
    });

    expect(handle).toHaveAttribute('aria-pressed', 'true');
    expect(handle).toHaveAttribute('data-armed', 'true');
  });

  it('does not arm the handle when a drag ends on it', () => {
    render(<HandleHarness />);
    const handle = screen.getByRole('button', { name: /^Jaw landmark,/ });

    // The real browser order is pointerdown -> pointermove -> pointerup -> click. `pointerup`
    // clears the drag rect, so a click-time check against *that* always sees null and every
    // completed drag would leave the handle armed — ready to teleport the guide on the user's
    // next click anywhere on the photograph.
    act(() => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    });
    act(() => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 60, clientY: 60 });
    });
    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 60, clientY: 60 });
    });
    act(() => {
      fireEvent.click(handle);
    });

    expect(handle).toHaveAttribute('aria-pressed', 'false');
  });

  it('still arms on a click that involved no pointer movement', () => {
    render(<HandleHarness />);
    const handle = screen.getByRole('button', { name: /^Jaw landmark,/ });

    // The other half of the guard: suppressing too eagerly would break the SC 2.5.7 path.
    act(() => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    });
    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    });
    act(() => {
      fireEvent.click(handle);
    });

    expect(handle).toHaveAttribute('aria-pressed', 'true');
  });

  it('still arms when the pointer jitters below the drag threshold', () => {
    const onMove = vi.fn();
    render(<HandleHarness onMove={onMove} />);
    const handle = screen.getByRole('button', { name: /^Jaw landmark,/ });

    // Browsers emit `pointermove` for a pixel of hand tremor. Treating any movement as a drag
    // makes the handle refuse to arm for exactly the people the non-dragging path exists for.
    act(() => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    });
    act(() => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 11, clientY: 11 });
    });
    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 11, clientY: 11 });
    });
    act(() => {
      fireEvent.click(handle);
    });

    expect(handle).toHaveAttribute('aria-pressed', 'true');
    // Sub-threshold movement must not nudge the guide either.
    expect(onMove).not.toHaveBeenCalled();
  });

  it('does not let a cancelled drag swallow the next keyboard activation', () => {
    render(<HandleHarness />);
    const handle = screen.getByRole('button', { name: /^Jaw landmark,/ });

    // `pointercancel` produces no click, so nothing downstream clears the suppression. The
    // next Enter press arrives as a bare `click` with no `pointerdown` to reset it — so a
    // stale flag would silently discard the keyboard path.
    act(() => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    });
    act(() => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 60, clientY: 60 });
    });
    act(() => {
      fireEvent.pointerCancel(handle, { pointerId: 1 });
    });
    act(() => {
      fireEvent.click(handle);
    });

    expect(handle).toHaveAttribute('aria-pressed', 'true');
  });

  it('disarms when the armed handle is clicked again', () => {
    render(<HandleHarness />);
    const handle = screen.getByRole('button');

    act(() => {
      fireEvent.click(handle);
    });
    act(() => {
      fireEvent.click(handle);
    });

    expect(handle).toHaveAttribute('aria-pressed', 'false');
  });

  it('carries a target at least 24 css px on both axes', () => {
    render(<HandleHarness />);

    // SC 2.5.8 (Target Size, Minimum). Asserted on the button, not the dot: the dot is drawn
    // deliberately smaller so it marks the feature instead of hiding it.
    const handle = screen.getByRole('button');
    expect(handle.style.width).toBe(`${MIN_TARGET_PX}px`);
    expect(handle.style.height).toBe(`${MIN_TARGET_PX}px`);
  });

  it('positions itself from normalized coordinates', () => {
    render(<HandleHarness initial={{ x: 0.25, y: 0.75 }} />);

    const handle = screen.getByRole('button');
    expect(handle.style.left).toBe('25%');
    expect(handle.style.top).toBe('75%');
  });

  it('refuses every input path when disabled', () => {
    const onMove = vi.fn();
    render(<HandleHarness disabled onMove={onMove} />);
    const handle = screen.getByRole('button');

    // FR-406: a feature the run abstained on is shown, not corrected.
    act(() => {
      fireEvent.click(handle);
    });
    pressKey(handle, 'ArrowRight', true);

    expect(handle).toHaveAttribute('aria-pressed', 'false');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('marks its status on the element so a proposal reads as provisional', () => {
    render(<HandleHarness status="adjusted" />);

    // A `proposed` guide backs no measured claim, so the distinction has to survive to the DOM
    // rather than living only in a colour.
    expect(screen.getByRole('button')).toHaveAttribute('data-status', 'adjusted');
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = render(<HandleHarness />);

    expect(await axe(container)).toHaveNoViolations();
  });

  // @trace category=a11y
  it('describes every handle with the shared operating instructions', () => {
    render(<HandleHarness />);

    const describedBy = screen.getByRole('button').getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      canvasLabels.instructions,
    );
  });

  // @trace category=a11y
  it('keeps the drawn dot out of the accessibility tree', () => {
    const { container } = render(<HandleHarness />);

    // The dot is decoration; the button carries the name. Exposing both would have a screen
    // reader announce an unnamed element inside every guide.
    const dot = container.querySelector('[data-slot="overlay-handle-dot"]');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });
});
