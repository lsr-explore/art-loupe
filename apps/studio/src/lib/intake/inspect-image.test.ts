// @vitest-environment node
// The inspector runs on the server, holds a Node `Buffer`-shaped view of the upload, and
// touches no DOM.

import { MAX_UPLOAD_BYTES, MIN_LONG_EDGE_PX } from '@artloupe/schemas';
import { describe, expect, it, vi } from 'vitest';
import { inspectImage, MAX_EXIF_JSON_BYTES } from './inspect-image';
import {
  GIF_BYTES,
  jpegBytes,
  pngBytes,
  SVG_BYTES,
  TEXT_BYTES,
  TRUNCATED_JPEG_BYTES,
  VALID_JPEG,
  VALID_PNG,
  VALID_WEBP,
  webpBytes,
} from './inspect-image.fixtures';

vi.mock('server-only', () => ({}));

// @trace flow=intake.project-intent category=functionality
describe('the formats FR-101 accepts', () => {
  it.each([
    ['JPEG', VALID_JPEG, 'image/jpeg'],
    ['PNG', VALID_PNG, 'image/png'],
    ['WebP', VALID_WEBP, 'image/webp'],
  ])('accepts a %s and reports its type', async (_label, bytes, expected) => {
    const result = await inspectImage(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inspection.mimeType).toBe(expected);
    }
  });

  it.each([
    ['PNG', pngBytes(1600, 1200)],
    ['JPEG', jpegBytes(1600, 1200)],
    ['WebP', webpBytes(1600, 1200)],
  ])('reads the real dimensions out of a %s', async (_label, bytes) => {
    const result = await inspectImage(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inspection.widthPx).toBe(1600);
      expect(result.inspection.heightPx).toBe(1200);
    }
  });

  it('reports the byte size it was actually given', async () => {
    const bytes = pngBytes(1600, 1200);
    const result = await inspectImage(bytes);
    expect(result.ok && result.inspection.byteSize).toBe(bytes.byteLength);
  });
});

// @trace flow=intake.project-intent category=security
describe('the formats it refuses', () => {
  it('refuses an SVG even though it decodes', () => {
    // The one that matters. SVG carries script, originals are served back through a
    // read-through route, and `image-size` is perfectly happy to give dimensions for one — so
    // "it decoded" is not the test. It is excluded by having no MIME-map entry, and this is
    // what proves that exclusion is load bearing rather than incidental.
    return expect(inspectImage(SVG_BYTES)).resolves.toEqual({
      ok: false,
      reason: 'unsupported_type',
    });
  });

  it('refuses a GIF', async () => {
    await expect(inspectImage(GIF_BYTES)).resolves.toEqual({
      ok: false,
      reason: 'unsupported_type',
    });
  });

  it('calls a truncated JPEG undecodable rather than unsupported', async () => {
    // Different problems need different sentences. Telling someone with a corrupt file that
    // JPEG is unsupported sends them off to convert a format that was never the issue.
    await expect(inspectImage(TRUNCATED_JPEG_BYTES)).resolves.toEqual({
      ok: false,
      reason: 'undecodable',
    });
  });

  it('refuses bytes that are not an image at all', async () => {
    await expect(inspectImage(TEXT_BYTES)).resolves.toEqual({
      ok: false,
      reason: 'undecodable',
    });
  });

  it('never consults a declared content type', () => {
    // There is no parameter to pass one. Stated as a test so that adding one — the obvious
    // "convenience" — has to delete this case and explain why.
    expect(inspectImage).toHaveLength(1);
  });
});

// @trace flow=intake.project-intent category=functionality
describe('the FR-101 bounds', () => {
  it('refuses an empty upload', async () => {
    await expect(inspectImage(new Uint8Array())).resolves.toEqual({
      ok: false,
      reason: 'missing_file',
    });
  });

  it('refuses bytes over the ceiling', async () => {
    // Built from a real PNG header so the refusal is about size and not about decodability —
    // otherwise this would pass even if the size check were deleted.
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    oversized.set(pngBytes(1600, 1200), 0);
    await expect(inspectImage(oversized)).resolves.toEqual({ ok: false, reason: 'too_large' });
  });

  it('checks size before it tries to decode', async () => {
    // An oversized file that is *also* undecodable must report `too_large`. Getting this
    // backwards means buffering and decoding 200 MB before refusing it on length.
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    await expect(inspectImage(oversized)).resolves.toEqual({ ok: false, reason: 'too_large' });
  });

  it(`refuses a long edge below ${MIN_LONG_EDGE_PX}px`, async () => {
    await expect(inspectImage(pngBytes(MIN_LONG_EDGE_PX - 1, 600))).resolves.toEqual({
      ok: false,
      reason: 'below_min_dimension',
    });
  });

  it('accepts a long edge exactly at the floor', async () => {
    // The boundary itself, in the inclusive direction. FR-101 says "minimum 800 px", so 800
    // passes — an off-by-one here would refuse a photograph the requirement accepts.
    const result = await inspectImage(pngBytes(MIN_LONG_EDGE_PX, 100));
    expect(result.ok).toBe(true);
  });

  it('measures the long edge, not the width', async () => {
    // A portrait-orientation photograph is 600 wide and 1200 tall. Checking width alone would
    // refuse it, which is exactly why FR-101 is written about the long edge.
    const result = await inspectImage(pngBytes(600, 1200));
    expect(result.ok).toBe(true);
  });
});

// @trace flow=safety.untrusted-input category=safety
describe('the metadata it keeps', () => {
  it('is always an object, even with no metadata to read', async () => {
    // The column is `not null default '{}'`. A `null` here would be a second spelling of "no
    // metadata" arriving at the database.
    const result = await inspectImage(pngBytes(1600, 1200));
    expect(result.ok && result.inspection.exif).toEqual({});
  });

  it('survives metadata it cannot parse, and says the read was incomplete', async () => {
    // A camera or editor that wrote a bad block must not cost the artist their upload — the
    // photograph is still exactly what FR-101 asks for.
    //
    // The assertion is on the *shape*, not just on survival, because exifr reports a bad
    // segment in-band as `{ errors: [Error] }` rather than by throwing. Left alone, those
    // Error objects reach a jsonb column and serialize to `{}` — junk that also cannot be
    // told apart from a file with an empty errors array.
    const withBadExif = new Uint8Array([
      ...jpegBytes(1600, 1200),
      0xff,
      0xe1,
      0x00,
      0x08,
      0x45,
      0x78,
      0x69,
      0x66,
    ]);
    const result = await inspectImage(withBadExif);
    expect(result.ok).toBe(true);
    expect(result.ok && result.inspection.exif).toEqual({ artloupe_metadata_incomplete: true });
  });

  it('keeps nothing that a jsonb column cannot hold', async () => {
    // The general form of the case above: whatever the decoder returns, it has to round-trip
    // through JSON, because the next thing that happens to it is a PostgREST insert.
    const withBadExif = new Uint8Array([
      ...jpegBytes(1600, 1200),
      0xff,
      0xe1,
      0x00,
      0x08,
      0x45,
      0x78,
      0x69,
      0x66,
    ]);
    const result = await inspectImage(withBadExif);
    const stored = result.ok ? result.inspection.exif : {};
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
  });

  it('bounds what it will store', () => {
    // EXIF is attacker-controlled and XMP has no practical size limit. Without a ceiling the
    // `exif` column is an unbounded write primitive for every signed-in artist.
    expect(MAX_EXIF_JSON_BYTES).toBeLessThanOrEqual(64 * 1024);
  });
});
