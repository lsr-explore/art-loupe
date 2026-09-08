import 'server-only';

/**
 * What an uploaded photograph actually is, decided from its bytes.
 *
 * FR-101 sets the bounds — JPEG, PNG or WebP, at most 25 MB, at least 800 px on the long edge,
 * "anything else is refused with a reason". This module is where those are decided, and the
 * important word is *decided*: every fact here comes from the bytes themselves.
 *
 * **The declared content type is never consulted.** A multipart part's `Content-Type` is a
 * string the client chose, and the accepted-format list is a security boundary rather than a
 * convenience — `image/svg+xml` renamed to `image/jpeg` is script in a document the app will
 * later serve back. So the type is sniffed, and the sniffed answer is what is stored, checked
 * against the constraint, and used to build the object. There is no path through this module
 * on which a caller's claim about its own file is believed.
 *
 * The bounds themselves come from `@artloupe/schemas` and are never restated here. They are
 * also a check constraint in `20260905183000_create_projects_and_reference_images.sql`, which
 * is what makes the refusal load bearing rather than advisory — this module exists so the
 * artist gets a reason they can read *before* Postgres gives them one they cannot.
 */

import {
  ACCEPTED_MIME_TYPES,
  type AcceptedMimeType,
  MAX_UPLOAD_BYTES,
  MIN_LONG_EDGE_PX,
} from '@artloupe/schemas';
import exifr from 'exifr';
import { imageSize } from 'image-size';

/**
 * Why an upload was refused. Each maps to a sentence the artist can act on.
 *
 * `undecodable` is kept apart from `unsupported_type` deliberately: "this is a format we do
 * not take" and "this says it is a JPEG and does not decode as one" are different problems,
 * and telling a artist with a truncated file that WebP is unsupported would send them off to
 * convert a file that was never the issue.
 */
export type ImageRejection =
  | 'missing_file'
  | 'too_large'
  | 'unsupported_type'
  | 'undecodable'
  | 'below_min_dimension';

export interface ImageInspection {
  /** Sniffed from the bytes, never taken from the request. */
  mimeType: AcceptedMimeType;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  /**
   * Decoded metadata, as untrusted provenance (FR-106).
   *
   * Always an object, `{}` when the file carries none — the column is `not null default '{}'`
   * and a `null` here would mean two spellings of "no metadata" reaching the database.
   */
  exif: Record<string, unknown>;
}

export type ImageInspectionResult =
  | { ok: true; inspection: ImageInspection }
  | { ok: false; reason: ImageRejection };

/**
 * `image-size` reports a format tag; the contract speaks MIME. Only the three FR-101 formats
 * appear here, so anything else it can decode — SVG, GIF, TIFF, HEIC, a favicon — falls
 * through to `unsupported_type` by having no entry rather than by a check someone must
 * remember to write.
 */
const MIME_BY_SNIFFED_TYPE: Record<string, AcceptedMimeType> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Largest metadata block kept, as serialized JSON.
 *
 * EXIF is attacker-controlled and XMP in particular has no practical size limit — a crafted
 * file can carry megabytes of it. Without a ceiling the `exif` column becomes an unbounded
 * write primitive for anyone who can upload, which is every signed-in artist.
 */
export const MAX_EXIF_JSON_BYTES = 64 * 1024;

/**
 * Read the metadata blocks that carry text.
 *
 * **GPS is deliberately not requested.** It is the one EXIF block that says where a person
 * was, it is not needed to plan a painting, and the cheapest way to not hold location data is
 * to never decode it. Turning this on is a privacy decision with a reason attached, not a
 * config change.
 *
 * Everything else text-bearing *is* requested, including XMP, because the screening surface is
 * "text inside the file" and a block we do not decode is a block we do not screen.
 */
const readMetadata = async (bytes: Uint8Array): Promise<Record<string, unknown>> => {
  let parsed: unknown;
  try {
    parsed = await exifr.parse(bytes, {
      // The TIFF segment must be on for the blocks inside it to be reachable at all. `ifd0`
      // rides with it and cannot be toggled separately — it is where Make, Model, Software,
      // Artist, Copyright and ImageDescription live, which is most of the text worth screening.
      tiff: true,
      exif: true,
      iptc: true,
      xmp: true,

      // **exifr leaves this off by default, and it is the single most important field here.**
      // `UserComment` is free-form, arbitrarily long, and the obvious place to hide text aimed
      // at a model. Screening the EXIF block without it would have looked like coverage and
      // been the opposite.
      userComment: true,

      // Location. Deliberately never decoded: it is the one EXIF block that says where a
      // person was, it is not needed to plan a painting, and the cheapest way to not hold
      // location data is to never read it. Turning this on is a privacy decision.
      gps: false,

      // Binary, not text. Decoding it would put a raw byte array into a jsonb column and
      // screen nothing, since the screener walks strings.
      makerNote: false,

      // PNG's IHDR chunk: width, height, bit depth, colour type. Every field of it is
      // already a column on `source_images`, and none of it is text, so decoding it would put
      // a second copy of the dimensions in the metadata blob and screen nothing.
      ihdr: false,

      // `ifd1` is the embedded thumbnail. Pixels, not provenance — decoding it would put a
      // second copy of an image inside the database row that describes the first.
      ifd1: false,
      interop: false,
      translateValues: true,
      reviveValues: false,
    });
  } catch {
    // Malformed metadata is ordinary. A camera or an editor that wrote a bad block should not
    // cost the artist their upload, and the photograph is still exactly what FR-101 wants.
    return {};
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  return boundMetadata(stripParseErrors(parsed as Record<string, unknown>));
};

/**
 * Take exifr's own failures back out of the result.
 *
 * **exifr reports a malformed segment in-band rather than by throwing**, as an `errors` array
 * of `Error` objects — so the `catch` above never sees it, and without this the array would go
 * straight into a `jsonb` column. `JSON.stringify(new RangeError('…'))` is `{}`, so what got
 * stored would be `{"errors":[{}]}`: not merely useless, but indistinguishable from a file
 * that had an empty errors array, and carrying a stack trace's worth of nothing.
 *
 * The fact that parsing was incomplete is worth keeping, so it survives as a flag. A reader of
 * the row can then tell "this file had no metadata" from "we could not read all of it", which
 * matters when the row is provenance.
 */
const stripParseErrors = (metadata: Record<string, unknown>): Record<string, unknown> => {
  if (!('errors' in metadata)) {
    return metadata;
  }

  const { errors, ...rest } = metadata;
  const failed = Array.isArray(errors) ? errors.length > 0 : errors !== undefined;
  return failed ? { ...rest, artloupe_metadata_incomplete: true } : rest;
};

/**
 * Drop metadata entries until the block fits, largest first.
 *
 * Dropping whole entries rather than truncating strings: a truncated value would still be
 * screened, and a rule that matched across the cut would produce an excerpt of text that never
 * existed. Losing an oversized field entirely is honest; a spliced one is not.
 *
 * What was dropped is recorded in place, so a reader of the row is not left thinking the file
 * simply had no `XMP`.
 */
export const boundMetadata = (metadata: Record<string, unknown>): Record<string, unknown> => {
  if (serializedLength(metadata) <= MAX_EXIF_JSON_BYTES) {
    return metadata;
  }

  // Smallest first, so one oversized XMP block costs its own field rather than every field
  // that happened to be enumerated after it.
  const bySizeAscending = Object.entries(metadata).sort(
    ([, left], [, right]) => serializedLength(left) - serializedLength(right),
  );

  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [key, value] of bySizeAscending) {
    const candidate = { ...kept, [key]: value };
    if (serializedLength(candidate) <= MAX_EXIF_JSON_BYTES) {
      kept[key] = value;
    } else {
      dropped.push(key);
    }
  }

  if (dropped.length === 0) {
    return kept;
  }

  // **The marker outranks the data it describes.** Everything below exists so that a trimmed
  // block can never read as a complete one: provenance that quietly omits its own omissions is
  // worse than provenance with a field missing, because nothing downstream can tell.
  //
  // So room is made for the count *first*, by evicting kept fields until it fits. Evicting one
  // more field costs a field; not doing so costs the fact that any field was lost.
  while (
    serializedLength({ ...kept, artloupe_dropped_field_count: dropped.length }) >
    MAX_EXIF_JSON_BYTES
  ) {
    const largest = Object.entries(kept).sort(
      ([, left], [, right]) => serializedLength(right) - serializedLength(left),
    )[0];
    if (largest === undefined) {
      break;
    }
    delete kept[largest[0]];
    dropped.push(largest[0]);
  }

  const bounded: Record<string, unknown> = {
    ...kept,
    artloupe_dropped_field_count: dropped.length,
  };

  // **The name ledger goes inside the budget, not on top of it.** Those names came out of the
  // file, so they are attacker-chosen too — a photograph carrying enough long XMP property
  // names pushes the stored object past the ceiling using the record of what was dropped. That
  // is the part that reads like bookkeeping and is not: it is the same untrusted input arriving
  // by another route, bounded only by the 25 MB upload ceiling above it.
  //
  // The names are the expendable half. The count is not.
  const names: string[] = [];
  for (const name of [...dropped].sort()) {
    const candidate = { ...bounded, artloupe_dropped_fields: [...names, name] };
    if (serializedLength(candidate) > MAX_EXIF_JSON_BYTES) {
      break;
    }
    names.push(name);
  }

  if (names.length > 0) {
    bounded.artloupe_dropped_fields = names;
  }

  // Last resort: the marker alone. Unreachable in practice — a single small integer against a
  // 64 KiB ceiling — but written down rather than assumed, because the alternative to being
  // wrong here is silently returning a block that claims to be whole.
  return serializedLength(bounded) <= MAX_EXIF_JSON_BYTES
    ? bounded
    : { artloupe_dropped_field_count: dropped.length };
};

const serializedLength = (value: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
  } catch {
    // A circular or non-serializable value cannot go into a jsonb column at all, so treating
    // it as infinitely large is what removes it.
    return Number.POSITIVE_INFINITY;
  }
};

/**
 * Decide what an uploaded file is, or why it is refused.
 *
 * Ordered so the cheapest refusal comes first: an over-large file is rejected on its length
 * before anything tries to decode 25 MB of it.
 */
export const inspectImage = async (bytes: Uint8Array): Promise<ImageInspectionResult> => {
  if (bytes.byteLength === 0) {
    return { ok: false, reason: 'missing_file' };
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  let dimensions: { width: number; height: number; type?: string };
  try {
    dimensions = imageSize(bytes);
  } catch {
    // `image-size` throws for anything it cannot recognise, which covers both a format we do
    // not accept and a file of an accepted format that is truncated or corrupt. The two are
    // separated below, where the sniffed type is known.
    return { ok: false, reason: 'undecodable' };
  }

  const mimeType = dimensions.type ? MIME_BY_SNIFFED_TYPE[dimensions.type] : undefined;
  if (mimeType === undefined) {
    return { ok: false, reason: 'unsupported_type' };
  }

  if (!Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height)) {
    return { ok: false, reason: 'undecodable' };
  }
  if (dimensions.width <= 0 || dimensions.height <= 0) {
    return { ok: false, reason: 'undecodable' };
  }

  // The long edge, not the width. Orientation does not enter into it: a rotated photograph
  // swaps which side is long, and `max` is the same number either way — which is exactly why
  // FR-101 is written about the long edge rather than about either dimension.
  if (Math.max(dimensions.width, dimensions.height) < MIN_LONG_EDGE_PX) {
    return { ok: false, reason: 'below_min_dimension' };
  }

  return {
    ok: true,
    inspection: {
      mimeType,
      widthPx: dimensions.width,
      heightPx: dimensions.height,
      byteSize: bytes.byteLength,
      exif: await readMetadata(bytes),
    },
  };
};

/** Re-exported so callers state the accepted list once, from the contract. */
export { ACCEPTED_MIME_TYPES };
