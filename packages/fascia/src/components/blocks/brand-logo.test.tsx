import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import darkSvg from '../../assets/brand-logo-dark.svg?raw';
import lightSvg from '../../assets/brand-logo-light.svg?raw';
import compactDarkSvg from '../../assets/brand-mark-dark.svg?raw';
import compactLightSvg from '../../assets/brand-mark-light.svg?raw';
import { BrandLogo } from './brand-logo';

const SOURCE = { light: lightSvg, dark: darkSvg };
const COMPACT = { light: compactLightSvg, dark: compactDarkSvg };

const body = (variant: 'light' | 'dark') =>
  SOURCE[variant].slice(SOURCE[variant].indexOf('</defs>'));

/**
 * Every geometry-bearing shape of a variant, in document order, reduced to the
 * attributes that decide what is drawn. Paint is compared separately — this is the
 * shape half of the drift guard.
 */
const geometry = (markup: string) =>
  [...markup.matchAll(/<(path|ellipse|line|circle)\s([^>]*?)\/?>/g)]
    .map(([, tag, attrs]) => {
      const attr = (name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
      const keys = {
        path: ['d'],
        ellipse: ['cx', 'cy', 'rx', 'ry'],
        line: ['x1', 'y1', 'x2', 'y2'],
        circle: ['cx', 'cy', 'r'],
      }[tag as 'path' | 'ellipse' | 'line' | 'circle'];
      return `${tag}:${keys.map(attr).join(',')}`;
    })
    .filter((entry) => !entry.includes('undefined'));

/** The same reduction over rendered DOM, so the two sides are directly comparable. */
const renderedGeometry = (svg: SVGSVGElement) =>
  [...svg.querySelectorAll('path, ellipse, line, circle')]
    .filter((node) => !node.closest('defs'))
    .map((node) => {
      const keys = {
        path: ['d'],
        ellipse: ['cx', 'cy', 'rx', 'ry'],
        line: ['x1', 'y1', 'x2', 'y2'],
        circle: ['cx', 'cy', 'r'],
      }[node.tagName as 'path' | 'ellipse' | 'line' | 'circle'];
      return `${node.tagName}:${keys.map((key) => node.getAttribute(key)).join(',')}`;
    });

// @trace flow=platform.shell category=functionality
describe('BrandLogo', () => {
  it('renders both variants so CSS, not JS, picks one', () => {
    const { container } = render(<BrandLogo />);
    const svgs = container.querySelectorAll('svg');

    expect(svgs).toHaveLength(2);
    expect(svgs[0].getAttribute('class')).toContain('dark:hidden');
    expect(svgs[1].getAttribute('class')).toContain('dark:block');
  });

  // The component holds the geometry once and the SVG files are the design source
  // of truth plus the favicon-generation input. Nothing but this test stops the two
  // from drifting apart.
  it.each(['light', 'dark'] as const)(
    'draws the same shapes, in order, as brand-logo-%s.svg',
    (variant) => {
      const { container } = render(<BrandLogo />);
      const svg = container.querySelectorAll('svg')[variant === 'light' ? 0 : 1];

      // Order is asserted, not just membership: SVG paints in document order, so a
      // reordering silently changes which shapes sit on top.
      expect(renderedGeometry(svg)).toEqual(geometry(body(variant)));
    },
  );

  it.each(['light', 'dark'] as const)(
    'carries the %s variant palette through to the rendered strokes',
    (variant) => {
      const { container } = render(<BrandLogo />);
      const svg = container.querySelectorAll('svg')[variant === 'light' ? 0 : 1];
      const source = body(variant);

      // Every solid colour the file names must appear in the render. A variant built
      // by stepping the other one's ink down a tone would fail here.
      const colors = new Set(
        [...source.matchAll(/(?:stroke|fill)="(#[0-9a-fA-F]{6})"/g)].map(([, color]) =>
          color.toLowerCase(),
        ),
      );

      const painted = new Set(
        [...svg.querySelectorAll('*')]
          .flatMap((node) => [node.getAttribute('stroke'), node.getAttribute('fill')])
          .filter((value): value is string => Boolean(value?.startsWith('#')))
          .map((value) => value.toLowerCase()),
      );

      for (const color of colors) {
        expect(painted).toContain(color);
      }
    },
  );

  it('fills the palette outline and the loupe glass from gradients, not flat colour', () => {
    const { container } = render(<BrandLogo />);
    const svg = container.querySelectorAll('svg')[0];
    const paths = [...svg.querySelectorAll('path')];

    expect(paths[0].getAttribute('stroke')).toMatch(/^url\(#.+-beam-light\)$/);
    expect(paths[1].getAttribute('fill')).toMatch(/^url\(#.+-glass-light\)$/);
  });

  it('gives each variant distinct gradient ids so neither repaints the other', () => {
    const { container } = render(<BrandLogo />);
    const ids = [...container.querySelectorAll('linearGradient')].map((node) => node.id);

    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps gradient ids unique across two logos on one page', () => {
    const { container } = render(
      <>
        <BrandLogo />
        <BrandLogo idPrefix="hero" />
      </>,
    );
    const ids = [...container.querySelectorAll('linearGradient')].map((node) => node.id);

    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });

  it('emits identical defs for two default instances, so a shared id is benign', () => {
    const { container } = render(
      <>
        <BrandLogo />
        <BrandLogo />
      </>,
    );
    // Four <defs>: light+dark for each instance. The property is that instance two
    // repeats instance one — NOT that light matches dark, which they never do.
    const [firstLight, firstDark, secondLight, secondDark] = [
      ...container.querySelectorAll('defs'),
    ];

    expect(secondLight.innerHTML).toBe(firstLight.innerHTML);
    expect(secondDark.innerHTML).toBe(firstDark.innerHTML);
  });

  // The compact mark is a separate silhouette rather than a crop, because a 6px
  // stroke on a 260-unit canvas vanishes below ~48px. These pin the two properties
  // that make it survive: it is filled, and the thumb hole is cut rather than painted.
  it.each(['light', 'dark'] as const)(
    'ships a filled compact %s mark for icon sizes',
    (variant) => {
      expect(COMPACT[variant]).toMatch(/viewBox="0 0 100 100"/);
      expect(COMPACT[variant]).toMatch(/fill="url\(#brand-mark-beam-/);
      // White keeps, black cuts — a painted-on dot would read as a blob on a dark ground.
      expect(COMPACT[variant]).toMatch(/<circle cx="96" cy="122" r="26" fill="#000"\/>/);
    },
  );

  it('is decorative by default, because the wordmark names the brand beside it', () => {
    render(<BrandLogo />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('takes an accessible name when it stands alone', () => {
    render(<BrandLogo label="Art Loupe" />);

    expect(screen.getByRole('img', { name: 'Art Loupe' })).toBeInTheDocument();
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = render(<BrandLogo label="Art Loupe" />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
