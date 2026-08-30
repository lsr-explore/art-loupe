/**
 * Generates the favicon / touch-icon / OG-image set from the two mark SVGs.
 *
 * Run from the repo root: `pnpm --filter @artloupe/fascia icons`
 *
 * Why the outputs don't live in fascia: Next's App Router emits `<link rel="icon">`
 * and the OG meta tags from files it finds in each app's `src/app/` directory. fascia
 * is a source-only workspace package — nothing serves it — so the *source* and this
 * script live here and the *artifacts* are written into every app.
 *
 * Why small sizes use different artwork: at 16px the full mark is mush. Its palette
 * outline is a 6px stroke on a 260-unit canvas — thinner than one device pixel once
 * scaled down — so it drops out, and the loupe collapses into a smudge. Cropping does
 * not help when the problem is stroke weight rather than framing, so the icons are
 * generated from `brand-mark-*.svg`: the same palette shape, filled instead of
 * stroked, with the loupe dropped and the thumb hole knocked out.
 */
import { Buffer } from 'node:buffer';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const FASCIA = resolve(HERE, '..');
const REPO = resolve(FASCIA, '../..');

/**
 * Apps that get a copy. Deliberately an explicit list rather than a scan of `apps/`:
 * these artifacts are committed, so the output set should be a decision in the diff,
 * not a function of what happens to be on disk.
 *
 * The cost of an explicit list is forgetting to extend it — a new app silently ships
 * with no icons. `assertNoAppsMissed` closes that: the script fails loudly instead.
 */
const APPS = ['studio', 'operations', 'entry'];

/**
 * Icons are generated from the COMPACT mark, not a crop of the full logo.
 *
 * The full mark is stroke-built — a 6px stroke on a 260-unit canvas — and reframing
 * it only changes which part of the smear you see. `brand-mark-*.svg` is a filled
 * palette silhouette with the thumb hole knocked out, drawn to survive 16px, and it
 * is already square. So there is nothing to reframe here.
 */
const ICON_VIEWBOX = '0 0 100 100';

/** Opaque plate for iOS, which composites transparent touch icons onto black. */
const PLATE_LIGHT = '#eef1f5';
const PLATE_DARK = '#151f28';

/** Compact silhouette — favicon, icon.svg, apple-icon. */
const source = (variant) =>
  readFileSync(resolve(FASCIA, `src/assets/brand-mark-${variant}.svg`), 'utf8');

/** Full mark, loupe and all — only the OG card is large enough to carry it. */
const fullMark = (variant) =>
  readFileSync(resolve(FASCIA, `src/assets/brand-logo-${variant}.svg`), 'utf8');

/** Already square and already simplified; only the render size changes. */
const reframed = (variant) =>
  Buffer.from(source(variant).replace('width="100" height="100"', 'width="164" height="164"'));

const png = (svg, size, background) => {
  const pipeline = sharp(svg, { density: 900 }).resize({
    width: size,
    height: size,
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  return (background ? pipeline.flatten({ background }) : pipeline).png().toBuffer();
};

/**
 * Minimal ICO container. The format is a 6-byte header, one 16-byte directory entry
 * per image, then the payloads — and every browser we care about accepts PNG payloads
 * inside it, so no BMP encoding and no extra dependency.
 */
const ico = (images) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
};

/**
 * An SVG favicon that follows the OS theme on its own — the tab chrome is dark in dark
 * mode, where the dark variant is the one that reads. Both variants go in the file and
 * a media query picks one, since a favicon gets no CSS from the page.
 */
const themedIconSvg = () => {
  /**
   * Takes the body of a variant by locating its element boundaries, rather than
   * stripping the prologue with a chain of `.replace()`s.
   *
   * The chain was not producing wrong output — a later `^[\s\S]*?<svg[^>]*>` removed
   * everything ahead of the opening tag regardless, so the comment strip was redundant
   * rather than incomplete. But CodeQL flags regex-stripping of `<!--` as incomplete
   * multi-character sanitization, and the shape deserves the flag: it is only correct
   * by accident of what follows it, and the next person to reorder those lines gets a
   * real bug. Extraction has one correct answer where blocklisting has many wrong ones,
   * and anything ahead of `<svg` is excluded by construction rather than by pattern.
   */
  const body = (variant) => {
    const svg = reframed(variant).toString();
    const openTagEnd = svg.indexOf('>', svg.indexOf('<svg'));
    const closeTagStart = svg.lastIndexOf('</svg>');

    if (openTagEnd === -1 || closeTagStart === -1) {
      throw new Error(`brand-mark-${variant}.svg has no parseable <svg> element`);
    }
    return svg.slice(openTagEnd + 1, closeTagStart).trim();
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ICON_VIEWBOX}" width="164" height="164">
  <style>
    .dark-only { display: none }
    @media (prefers-color-scheme: dark) {
      .light-only { display: none }
      .dark-only { display: inline }
    }
  </style>
  <g class="light-only">${body('light')}</g>
  <g class="dark-only">${body('dark')}</g>
</svg>
`;
};

/** Turns "someone added an app and forgot" from a silent gap into a failed run. */
const assertNoAppsMissed = () => {
  const onDisk = readdirSync(resolve(REPO, 'apps'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const missing = onDisk.filter((app) => !APPS.includes(app));

  if (missing.length > 0) {
    throw new Error(
      `apps/${missing.join(', apps/')} exist but are not in APPS, so they would ship with no ` +
        `icons. Add them to APPS in ${'scripts/generate-icons.mjs'} and re-run.`,
    );
  }
};

const main = async () => {
  assertNoAppsMissed();

  const [ico16, ico32, ico48] = await Promise.all(
    [16, 32, 48].map((size) => png(reframed('light'), size)),
  );
  const favicon = ico([
    { size: 16, data: ico16 },
    { size: 32, data: ico32 },
    { size: 48, data: ico48 },
  ]);

  // 180px is far above where the mark stops holding together, so the touch icon gets
  // the *full* mark, not the reframed one — the crop exists only to survive 16px, and
  // applied here it just lops the tower off at the tile edge. Inset on a plate because
  // iOS composites transparent touch icons onto black and crops flush artwork.
  const appleMark = await png(Buffer.from(source('light')), 144);
  const appleIcon = await sharp({
    create: { width: 180, height: 180, channels: 4, background: PLATE_LIGHT },
  })
    .composite([{ input: appleMark, gravity: 'centre' }])
    .png()
    .toBuffer();

  const iconSvg = themedIconSvg();

  // OG cards are viewed on light and dark chrome alike; a dark plate reads better and
  // matches the product surfaces. The FULL mark here, not the compact one the icons
  // use — at 1200x630 the loupe and the swatches read fine, and dropping them would
  // throw away the detail the card has room for.
  const ogMark = await png(Buffer.from(fullMark('dark')), 420);
  const ogImage = await sharp({
    create: { width: 1200, height: 630, channels: 4, background: PLATE_DARK },
  })
    .composite([{ input: ogMark, gravity: 'centre' }])
    .png()
    .toBuffer();

  for (const app of APPS) {
    const appDir = resolve(REPO, 'apps', app, 'src/app');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(resolve(appDir, 'favicon.ico'), favicon);
    writeFileSync(resolve(appDir, 'icon.svg'), iconSvg);
    writeFileSync(resolve(appDir, 'apple-icon.png'), appleIcon);
    writeFileSync(resolve(appDir, 'opengraph-image.png'), ogImage);
    console.log(`${app}: favicon.ico, icon.svg, apple-icon.png, opengraph-image.png`);
  }
};

await main();
