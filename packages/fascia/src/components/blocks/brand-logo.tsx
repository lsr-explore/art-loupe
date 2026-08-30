import { cn } from '../../lib/utils';

/**
 * Geometry of the Art Loupe mark, shared by both variants.
 *
 * The two variants differ *only* in paint — the light/dark SVGs in `../../assets`
 * are the design source of truth and the generation input for the favicon set, and
 * `brand-logo.test.tsx` asserts this table still matches them. Holding the geometry
 * once is what makes that guarantee possible: two hand-maintained copies would
 * drift silently the first time a curve is nudged.
 *
 * The mark is a painter's palette outline with a photographic loupe standing on it.
 * It is stroke-built rather than filled, which is why the compact favicon mark
 * (`brand-mark-*.svg`) is a separate, filled silhouette: a 6px stroke on a 260-unit
 * canvas disappears below about 48px, and cropping this artwork would not fix that.
 */
const PALETTE_OUTLINE =
  'M 120,0 C 180,0 220,30 220,80 C 220,130 180,180 120,180 C 70,180 40,160 40,140 C 40,120 60,110 60,90 C 60,70 0,60 0,30 C 0,10 50,0 120,0 Z';

const LOUPE_SKIRT = 'M -28,25 L -18,-5 C -18,-15 18,-15 18,-5 L 28,25 Z';

/** Knurling on the eyepiece ring. The centre ridge is the highlight. */
const RIDGES: { x: number; y1: number; y2: number; highlight?: true }[] = [
  { x: -16, y1: -7, y2: -1 },
  { x: -8, y1: -8, y2: -2 },
  { x: 0, y1: -8.5, y2: -2.5, highlight: true },
  { x: 8, y1: -8, y2: -2 },
  { x: 16, y1: -7, y2: -1 },
];

/** Pigment dots on the palette, in the order they paint. */
const SWATCHES: { cx: number; cy: number; key: 'one' | 'two' | 'three' | 'four' }[] = [
  { cx: 55, cy: 40, key: 'one' },
  { cx: 100, cy: 28, key: 'two' },
  { cx: 160, cy: 35, key: 'three' },
  { cx: 185, cy: 75, key: 'four' },
];

type Variant = 'light' | 'dark';

interface Paint {
  /** Three-stop warm→cool gradient carried by the palette outline. */
  beam: [string, string, string];
  /** Glass skirt of the loupe, as [colour, opacity] stops. */
  glass: [[string, number], [string, number], [string, number]];
  accent: string;
  eyepieceFill: string;
  eyepieceStroke: string;
  lens: string;
  lensOpacity: number;
  ridge: string;
  ridgeHighlight: string;
  swatches: Record<'one' | 'two' | 'three' | 'four', string>;
}

/**
 * The light variant is not the dark one with the ink stepped down a tone.
 *
 * Two inversions matter. The cool end of the gradient and the cyan swatch are
 * darkened outright (`#4facfe` → `#0369a1`), because the dark-variant values are
 * too pale to hold on white. And the glass skirt fades *ink* into the ground on
 * light where it fades *white* on dark — a white-to-transparent fade is invisible
 * on a white surface, so keeping it would have deleted the loupe body.
 *
 * The lens interior stays dark on both. It reads as barrel, not as a plate.
 */
const PAINT: Record<Variant, Paint> = {
  light: {
    beam: ['#e11d48', '#ea7317', '#0369a1'],
    glass: [
      ['#114551', 0.3],
      ['#114551', 0.06],
      ['#0369a1', 0.28],
    ],
    accent: '#0369a1',
    eyepieceFill: '#114551',
    eyepieceStroke: '#114551',
    lens: '#38bdf8',
    lensOpacity: 0.9,
    ridge: '#7c8aa5',
    ridgeHighlight: '#dbf0f0',
    swatches: { one: '#e11d48', two: '#ea7317', three: '#0369a1', four: '#0891b2' },
  },
  dark: {
    beam: ['#ff5e62', '#ff9966', '#4facfe'],
    glass: [
      ['#ffffff', 0.6],
      ['#ffffff', 0.1],
      ['#4facfe', 0.4],
    ],
    accent: '#4facfe',
    eyepieceFill: '#181b29',
    eyepieceStroke: '#ffffff',
    lens: '#00f2fe',
    lensOpacity: 0.8,
    ridge: '#8b94b2',
    ridgeHighlight: '#ffffff',
    swatches: { one: '#ff5e62', two: '#ff9966', three: '#4facfe', four: '#00f2fe' },
  },
};

/**
 * Gradient ids must be unique per *document*, not per file — both variants are in
 * the DOM at once, so a shared id would let one variant's gradient repaint the
 * other's outline. `idPrefix` is also a prop so two logos on one page (header +
 * hero) don't collide either.
 */
const beamId = (variant: Variant, idPrefix: string) => `${idPrefix}-beam-${variant}`;
const glassId = (variant: Variant, idPrefix: string) => `${idPrefix}-glass-${variant}`;

const Mark = ({
  variant,
  idPrefix,
  className,
}: {
  variant: Variant;
  idPrefix: string;
  className: string;
}) => {
  const paint = PAINT[variant];
  const beam = beamId(variant, idPrefix);
  const glass = glassId(variant, idPrefix);

  return (
    <svg
      viewBox="0 0 260 220"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <defs>
        {/*
          `userSpaceOnUse` with the artwork's own coordinates, so the gradient spans
          the outline rather than each subpath's bounding box. The coordinates are
          the outer frame's, which is why these live outside the translated group.
        */}
        <linearGradient id={beam} gradientUnits="userSpaceOnUse" x1="20" y1="20" x2="240" y2="20">
          <stop offset="0" stopColor={paint.beam[0]} />
          <stop offset="0.5" stopColor={paint.beam[1]} />
          <stop offset="1" stopColor={paint.beam[2]} />
        </linearGradient>
        <linearGradient
          id={glass}
          gradientUnits="userSpaceOnUse"
          x1="112"
          y1="130"
          x2="168"
          y2="130"
        >
          {paint.glass.map(([color, opacity], index) => (
            <stop
              key={`${color}-${opacity}`}
              offset={index / 2}
              stopColor={color}
              stopOpacity={opacity}
            />
          ))}
        </linearGradient>
      </defs>

      <g transform="translate(20, 20)">
        <path d={PALETTE_OUTLINE} fill="none" stroke={`url(#${beam})`} strokeWidth="6" />

        <g transform="translate(120, 90)">
          <path
            d={LOUPE_SKIRT}
            fill={`url(#${glass})`}
            stroke={paint.accent}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <ellipse
            cx="0"
            cy="25"
            rx="28"
            ry="10"
            fill="none"
            stroke={paint.accent}
            strokeWidth="2.5"
          />
          <ellipse
            cx="0"
            cy="-5"
            rx="20"
            ry="8"
            fill={paint.eyepieceFill}
            stroke={paint.eyepieceStroke}
            strokeWidth="3"
          />
          <ellipse
            cx="0"
            cy="-5"
            rx="14"
            ry="5"
            fill="none"
            stroke={paint.lens}
            strokeWidth="1.5"
            opacity={paint.lensOpacity}
          />
          {RIDGES.map((ridge) => (
            <line
              key={ridge.x}
              x1={ridge.x}
              y1={ridge.y1}
              x2={ridge.x}
              y2={ridge.y2}
              stroke={ridge.highlight ? paint.ridgeHighlight : paint.ridge}
              strokeWidth="1.5"
            />
          ))}
        </g>

        {SWATCHES.map((swatch) => (
          <circle
            key={swatch.key}
            cx={swatch.cx}
            cy={swatch.cy}
            r="8"
            fill={paint.swatches[swatch.key]}
          />
        ))}
      </g>
    </svg>
  );
};

interface BrandLogoProps {
  /**
   * Accessible name. Omit when the "Art Loupe" wordmark sits beside the mark
   * (the normal header case) — a name here would make screen readers announce the
   * brand twice. Pass one only when the mark stands alone.
   */
  label?: string;
  /** Height utility; width follows the aspect ratio. */
  className?: string;
  /**
   * Namespaces the gradient ids. The default is deliberately a constant, not
   * `useId()` — see the note on the component.
   */
  idPrefix?: string;
}

/**
 * The Art Loupe mark, shared by all surfaces.
 *
 * Both variants render and CSS picks one (`dark:hidden` / `hidden dark:block`), so
 * this stays a server component: reading the theme in JS would mean a `useTheme`
 * hook, a client boundary, and a wrong-variant flash on first paint. `display: none`
 * also drops the inactive copy from the accessibility tree, so nothing is announced
 * twice.
 *
 * On the constant `idPrefix` default: two default instances on one page do emit
 * duplicate `id`s, which is invalid HTML. `useId()` would fix that, but it is a hook,
 * so it would make this a client component and ship the geometry in the JS bundle on
 * top of the HTML — a real cost on every page, to fix a collision that cannot
 * misrender. The colliding definitions are byte-identical (asserted in the tests), so
 * `url(#…)` resolving to the first is indistinguishable from resolving to its own.
 * Pass an explicit `idPrefix` when a page has more than one, and revisit this the
 * moment two instances can differ.
 */
export const BrandLogo = ({ label, className, idPrefix = 'brand' }: BrandLogoProps) => (
  <span
    className={cn('inline-flex h-8 shrink-0 items-center', className)}
    {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
  >
    <Mark variant="light" idPrefix={idPrefix} className="block h-full w-auto dark:hidden" />
    <Mark variant="dark" idPrefix={idPrefix} className="hidden h-full w-auto dark:block" />
  </span>
);
