import { describe, expect, it } from 'vitest';
import {
  clampPoint,
  describePoint,
  MIN_TARGET_PX,
  pointFromClientPosition,
  toPercent,
} from './overlay-geometry';

const RECT = { left: 100, top: 50, width: 400, height: 200 };

// @trace flow=analysis.geometry category=functionality
describe('overlay geometry', () => {
  it('clamps a point dragged past the edge back onto the photograph', () => {
    expect(clampPoint({ x: 1.4, y: -0.3 })).toEqual({ x: 1, y: 0 });
  });

  it('leaves a point inside the unit square untouched', () => {
    expect(clampPoint({ x: 0.4627, y: 0.3723 })).toEqual({ x: 0.4627, y: 0.3723 });
  });

  it('converts a pointer position to normalized coordinates', () => {
    expect(pointFromClientPosition(300, 150, RECT)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('clamps a pointer position that left the element mid-drag', () => {
    expect(pointFromClientPosition(1000, 0, RECT)).toEqual({ x: 1, y: 0 });
  });

  it('returns the origin rather than NaN for a zero-sized rect', () => {
    // jsdom and the first paint both produce this. NaN here would not misplace the
    // correction, it would poison the value that gets persisted as an artist-authored fact.
    const point = pointFromClientPosition(10, 10, { left: 0, top: 0, width: 0, height: 0 });

    expect(point).toEqual({ x: 0, y: 0 });
    expect(Number.isNaN(point.x)).toBe(false);
  });

  it('renders CSS percentages for positioning', () => {
    expect(toPercent({ x: 0.25, y: 0.5 })).toEqual({ left: '25%', top: '50%' });
  });

  it('rounds to whole percentages for announcement', () => {
    // A screen reader re-reading fourteen decimals on every arrow press is unusable.
    expect(describePoint({ x: 0.4627, y: 0.3723 })).toEqual({ xPercent: 46, yPercent: 37 });
  });

  it('keeps the minimum target at the WCAG 2.2 SC 2.5.8 floor', () => {
    // Guards the number itself: the components lay out against this constant, so lowering it
    // would silently shrink every hit target below the AA requirement.
    expect(MIN_TARGET_PX).toBeGreaterThanOrEqual(24);
  });
});
