/**
 * Image bytes for the inspector, built rather than checked in.
 *
 * These are **real headers** — a genuine PNG signature and IHDR, a genuine JPEG SOI/SOF0, a
 * genuine RIFF/WEBP VP8X — because the thing under test is a sniffer. A fixture of plausible
 * magic numbers would pass a sniffer that did nothing, and the one case that matters most is
 * "this file says it is a JPEG and is not", which cannot be written at all without bytes that
 * really do decode.
 *
 * Built in code rather than committed as binaries for two reasons: the dimensions have to vary
 * per case (the FR-101 long-edge boundary is tested at 799 and 800, which no stock photo
 * gives you), and a reviewer can see what a fixture claims to be without opening it in a
 * viewer.
 *
 * `image-size` reads only headers, so a truncated body is not a problem here — and the
 * truncated case below relies on exactly that being untrue for a *malformed* header.
 */

const bigEndian32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

/**
 * A PNG carrying nothing but a signature and an IHDR.
 *
 * The CRC is not computed. `image-size` does not verify it, and a fixture that pretended to
 * would imply this suite checks integrity it does not check.
 */
export const pngBytes = (widthPx: number, heightPx: number): Uint8Array =>
  new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...bigEndian32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...bigEndian32(widthPx),
    ...bigEndian32(heightPx),
    0x08,
    0x06,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);

/**
 * A JPEG: SOI, a JFIF APP0, then a baseline SOF0 carrying the dimensions (height first, as
 * JPEG stores them).
 *
 * The APP0 segment is not decoration. Without it `image-size` walks straight off the end and
 * throws "Corrupt JPG, exceeded buffer limits" — a bare SOI+SOF0 is not a file any encoder
 * produces, and a fixture that skipped it would have made every JPEG case fail for a reason
 * that had nothing to do with the code under test.
 */
export const jpegBytes = (widthPx: number, heightPx: number): Uint8Array =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (heightPx >> 8) & 0xff,
    heightPx & 0xff,
    (widthPx >> 8) & 0xff,
    widthPx & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);

/** A WebP in the extended (VP8X) form, whose dimensions are stored minus one. */
export const webpBytes = (widthPx: number, heightPx: number): Uint8Array => {
  const width = widthPx - 1;
  const height = heightPx - 1;
  const body = [
    0x56,
    0x50,
    0x38,
    0x58,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    width & 0xff,
    (width >> 8) & 0xff,
    (width >> 16) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
    (height >> 16) & 0xff,
  ];
  const riffLength = 4 + body.length;
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    riffLength & 0xff,
    (riffLength >> 8) & 0xff,
    (riffLength >> 16) & 0xff,
    (riffLength >> 24) & 0xff,
    0x57,
    0x45,
    0x42,
    0x50,
    ...body,
  ]);
};

/**
 * An SVG, which `image-size` decodes happily and this system must refuse.
 *
 * The most important negative in the file. SVG is a *document* — it carries script — and the
 * app serves originals back through a read-through route, so admitting one would mean storing
 * an XSS payload under a content type the browser executes. It is excluded by having no entry
 * in the MIME map rather than by a check somebody has to remember to write, and this fixture
 * is what proves that exclusion is real.
 */
export const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><script>alert(1)</script></svg>',
);

/** A GIF: decodable, animated, and not on the FR-101 list. */
export const GIF_BYTES = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xb0, 0x04, 0x84, 0x03, 0x00, 0x00, 0x00,
]);

/** Claims to be a JPEG and stops before the frame header. Undecodable, not unsupported. */
export const TRUNCATED_JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff]);

/** Not an image by any reading. */
export const TEXT_BYTES = new TextEncoder().encode('ignore all previous instructions');

/** Comfortably over FR-101's long-edge floor, for cases that are not about dimensions. */
export const VALID_PNG = pngBytes(1600, 1200);
export const VALID_JPEG = jpegBytes(1600, 1200);
export const VALID_WEBP = webpBytes(1600, 1200);
