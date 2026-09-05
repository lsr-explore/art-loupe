import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { OverlayGuide } from './overlay-guide';

const HORIZON = { from: { x: 0, y: 0.42 }, to: { x: 1, y: 0.44 } };

// @trace flow=analysis.geometry category=functionality
describe('OverlayGuide', () => {
  it('draws between two normalized points in the unit viewBox', () => {
    const { container } = render(<OverlayGuide {...HORIZON} status="confirmed" />);

    // The viewBox is the coordinate space made literal: the detector's 0.42 is written as
    // 0.42, with no conversion in between to get wrong.
    const svg = container.querySelector('[data-slot="overlay-guide"]');
    expect(svg).toHaveAttribute('viewBox', '0 0 1 1');
    const line = container.querySelector('line');
    expect(line).toHaveAttribute('x1', '0');
    expect(line).toHaveAttribute('y1', '0.42');
    expect(line).toHaveAttribute('x2', '1');
    expect(line).toHaveAttribute('y2', '0.44');
  });

  it('keeps the stroke width uniform under a non-uniform stretch', () => {
    const { container } = render(<OverlayGuide {...HORIZON} status="confirmed" />);

    // Without this, `preserveAspectRatio="none"` renders a horizon on a wide image as a thick
    // smear and a vertical guide as a hairline.
    expect(container.querySelector('line')).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  });

  it('dashes a proposal and solidifies a confirmed guide', () => {
    const { container: proposed } = render(<OverlayGuide {...HORIZON} status="proposed" />);
    const { container: confirmed } = render(<OverlayGuide {...HORIZON} status="confirmed" />);

    // A proposal backs no measured claim until the artist acts on it, so it should not look
    // like a settled fact.
    expect(proposed.querySelector('line')).toHaveAttribute('stroke-dasharray');
    expect(confirmed.querySelector('line')).not.toHaveAttribute('stroke-dasharray');
  });

  it('never intercepts pointer events aimed at the handles beneath it', () => {
    const { container } = render(<OverlayGuide {...HORIZON} status="confirmed" />);

    // The guide spans the whole canvas. Without this it would swallow every click meant for a
    // handle, including the placement click.
    expect(container.querySelector('[data-slot="overlay-guide"]')).toHaveClass(
      'pointer-events-none',
    );
  });

  // @trace category=a11y
  it('is hidden from assistive technology unless it is given a label', () => {
    const { container } = render(<OverlayGuide {...HORIZON} status="confirmed" />);

    // A guide whose ends are themselves handles is already described by them; naming the line
    // too makes a screen reader read the same fact twice.
    expect(container.querySelector('[data-slot="overlay-guide"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  // @trace category=a11y
  it('exposes itself as a named image when it carries a label', () => {
    render(<OverlayGuide {...HORIZON} label="Horizon line, confirmed" status="confirmed" />);

    expect(screen.getByRole('img', { name: 'Horizon line, confirmed' })).toBeInTheDocument();
  });

  // @trace category=a11y
  it('has no accessibility violations in either exposure', async () => {
    const { container } = render(
      <>
        <OverlayGuide {...HORIZON} status="proposed" />
        <OverlayGuide {...HORIZON} label="Horizon line, adjusted" status="adjusted" />
      </>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
