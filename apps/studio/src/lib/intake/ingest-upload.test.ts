// @vitest-environment node
// Two systems, a checksum over real bytes, and no DOM anywhere in it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeChecksum } from '@/lib/storage/checksum';
import { ingestUpload, NOT_SCREENED_RULE_ID } from './ingest-upload';
import {
  ACCESS_TOKEN,
  ANON_KEY,
  CLEAN_FILENAME,
  HOSTILE_FILENAME,
  HOSTILE_GOAL_INTENT,
  IMAGE_BYTES,
  INTENT,
  jsonResponse,
  OWNER_ID,
  PROJECT_ID,
  STORAGE_KEY_FOR,
  SUPABASE_URL,
  stubIngestFetch,
} from './ingest-upload.fixtures';
import { pngBytes, SVG_BYTES } from './inspect-image.fixtures';

vi.mock('server-only', () => ({}));

const CHECKSUM = computeChecksum(IMAGE_BYTES);

const ingest = (
  overrides: Partial<Parameters<typeof ingestUpload>[0]> = {},
  fetchImpl?: typeof fetch,
) =>
  ingestUpload({
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    accessToken: ACCESS_TOKEN,
    ownerId: OWNER_ID,
    filename: CLEAN_FILENAME,
    bytes: IMAGE_BYTES,
    intent: INTENT,
    fetchImpl,
    ...overrides,
  });

beforeEach(() => {
  // `clearAllMocks`, never `restoreAllMocks`: restore only touches `vi.spyOn` mocks, so a
  // plain `vi.fn()` would keep its call history and every "was not called" assertion here
  // would pass without asserting anything.
  vi.clearAllMocks();
});

// @trace flow=intake.project-intent category=data
describe('the order the two systems are written in', () => {
  it('uploads the object BEFORE the row that cites it', async () => {
    // The load-bearing assertion of this PR. `artloupe_reference_images_insert_own` refuses a
    // write to a key some `source_images` row already cites, so row-first makes every first
    // upload fail with a bare storage permissions error that reads like a broken policy.
    // Nothing about the two calls' shapes differs between the orders — only the sequence does.
    const stub = stubIngestFetch();
    await ingest({}, stub.fetchImpl);

    expect(stub.calls).toEqual([
      'project-insert',
      'object-upload',
      'source-image-insert',
      'detection-insert',
    ]);
    expect(stub.calls.indexOf('object-upload')).toBeLessThan(
      stub.calls.indexOf('source-image-insert'),
    );
  });

  it('creates the project before anything that needs its id', async () => {
    const stub = stubIngestFetch();
    await ingest({}, stub.fetchImpl);
    expect(stub.calls[0]).toBe('project-insert');
  });

  it('writes the detections last, once the upload is already valid', async () => {
    // Deliberately last: a bookkeeping failure must not be able to destroy a complete project.
    const stub = stubIngestFetch();
    await ingest({}, stub.fetchImpl);
    expect(stub.calls.at(-1)).toBe('detection-insert');
  });
});

// @trace flow=intake.project-intent category=data
describe('what it writes', () => {
  it('keys the object on the content checksum, under the artist prefix', async () => {
    const stub = stubIngestFetch();
    const result = await ingest({}, stub.fetchImpl);

    expect(result.ok && result.result.storageKey).toBe(STORAGE_KEY_FOR(CHECKSUM));
    expect(result.ok && result.result.checksum).toBe(CHECKSUM);
  });

  it('sends the sniffed dimensions and type, not anything it was told', async () => {
    const stub = stubIngestFetch();
    await ingest({}, stub.fetchImpl);

    expect(stub.bodies['source-image-insert']).toMatchObject({
      project_id: PROJECT_ID,
      checksum: CHECKSUM,
      mime_type: 'image/jpeg',
      width_px: 1600,
      height_px: 1200,
      byte_size: IMAGE_BYTES.byteLength,
    });
  });

  it('stores the filename as provenance and never as a path', async () => {
    // FR-106. The key is built from ids and a checksum precisely so that a filename — which is
    // attacker-controlled — cannot shape where bytes land.
    const stub = stubIngestFetch();
    const result = await ingest({ filename: '../../etc/passwd' }, stub.fetchImpl);

    expect(stub.bodies['source-image-insert']).toMatchObject({
      original_filename: '../../etc/passwd',
    });
    expect(result.ok && result.result.storageKey).toBe(STORAGE_KEY_FOR(CHECKSUM));
  });

  it('sends the owner id explicitly, for RLS to check rather than trust', async () => {
    const stub = stubIngestFetch();
    await ingest({}, stub.fetchImpl);
    expect(stub.bodies['project-insert']).toMatchObject({ owner_id: OWNER_ID, intent: INTENT });
  });
});

// @trace flow=safety.untrusted-input category=safety
describe('screening at ingest', () => {
  it('screens the filename', async () => {
    const stub = stubIngestFetch();
    const result = await ingest({ filename: HOSTILE_FILENAME }, stub.fetchImpl);

    expect(result.ok).toBe(true);
    expect(result.ok && result.result.detections).toEqual([
      expect.objectContaining({ surface: 'filename', ruleId: 'instruction-override' }),
    ]);
  });

  it("screens the artist's free-text goal", async () => {
    // Not because the artist is untrusted — because the goal field is where pasted text
    // arrives, and it reaches a model prompt in PR 12. `intent.ts` already promised this.
    const stub = stubIngestFetch();
    const result = await ingest({ intent: HOSTILE_GOAL_INTENT }, stub.fetchImpl);

    expect(result.ok && result.result.detections).toEqual([
      expect.objectContaining({ surface: 'project-goal', ruleId: 'instruction-override' }),
    ]);
  });

  it('screens before it stores', async () => {
    // FR-803 is "screening before any model sees the bytes", and the weaker property that
    // makes it checkable here is that nothing is written until screening has run. If the
    // screener threw, no project would exist.
    const stub = stubIngestFetch();
    await ingest({ filename: HOSTILE_FILENAME }, stub.fetchImpl);
    expect(stub.calls.indexOf('project-insert')).toBe(0);
  });

  it('records a detection with the surface, rule, severity and excerpt', async () => {
    const stub = stubIngestFetch();
    await ingest({ filename: HOSTILE_FILENAME }, stub.fetchImpl);

    expect(stub.bodies['detection-insert']).toEqual(
      expect.arrayContaining([
        {
          project_id: PROJECT_ID,
          surface: 'filename',
          rule_id: 'instruction-override',
          severity: 'high',
          excerpt: expect.any(String),
        },
      ]),
    );
  });

  it('records the surfaces it did NOT screen', async () => {
    // The honesty assertion. An absent row is indistinguishable from a clean one, so without
    // this the ops panel reports "no detections" across surfaces nothing has ever read.
    const stub = stubIngestFetch();
    await ingest({}, stub.fetchImpl);

    expect(stub.bodies['detection-insert']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: 'ocr',
          rule_id: NOT_SCREENED_RULE_ID,
          severity: 'none',
        }),
      ]),
    );
  });

  it('still writes the unscreened-surface record when nothing was detected', async () => {
    const stub = stubIngestFetch();
    const result = await ingest({}, stub.fetchImpl);

    expect(result.ok && result.result.detections).toEqual([]);
    expect(stub.bodies['detection-insert']).toHaveLength(1);
  });

  it('makes a retry idempotent rather than doubling the counts', async () => {
    // The table is unique on (project_id, surface, rule_id); this is the request-side half.
    const stub = stubIngestFetch();
    const seen: string[] = [];
    const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input));
      return stub.fetchImpl(input, init);
    }) as unknown as typeof fetch;

    await ingest({}, recording);
    expect(seen.some((url) => url.includes('on_conflict=project_id,surface,rule_id'))).toBe(true);
  });
});

// @trace flow=intake.project-intent category=data
describe('when a step fails', () => {
  it('removes the project when the object cannot be uploaded', async () => {
    const stub = stubIngestFetch({ objectUpload: jsonResponse({}, 500) });
    const result = await ingest({}, stub.fetchImpl);

    expect(result.ok).toBe(false);
    expect(stub.calls).toEqual(['project-insert', 'object-upload', 'project-delete']);
  });

  it('removes the object AND the project when the row cannot be written', async () => {
    // Object before rows on the way out, the same order `delete-project.ts` uses and for the
    // same reason: rows gone with bytes left is a deleted photograph still retrievable by key.
    const stub = stubIngestFetch({ sourceImageInsert: jsonResponse({}, 500) });
    const result = await ingest({}, stub.fetchImpl);

    expect(result.ok).toBe(false);
    expect(stub.calls).toEqual([
      'project-insert',
      'object-upload',
      'source-image-insert',
      'object-delete',
      'project-delete',
    ]);
  });

  it('reports an already-claimed key as a duplicate, not as a refusal', async () => {
    // The key ends in the content checksum, so a claimed key means this artist already
    // uploaded these exact bytes. Telling them they lacked permission would be wrong.
    const stub = stubIngestFetch({ objectUpload: jsonResponse({}, 409) });
    const result = await ingest({}, stub.fetchImpl);

    expect(result).toEqual({ ok: false, failure: { kind: 'duplicate' } });
  });

  it('does not write anything when the project insert fails', async () => {
    const stub = stubIngestFetch({ projectInsert: jsonResponse({}, 403) });
    const result = await ingest({}, stub.fetchImpl);

    expect(result.ok).toBe(false);
    expect(stub.calls).toEqual(['project-insert']);
  });

  it('refuses a body that is not one row carrying an id', async () => {
    // PostgREST answers an insert with an array. Indexing into it blindly would put
    // `undefined` straight into a storage key.
    const stub = stubIngestFetch({ projectInsert: jsonResponse([{}, {}], 201) });
    const result = await ingest({}, stub.fetchImpl);

    expect(result.ok).toBe(false);
    expect(stub.calls).toEqual(['project-insert']);
  });

  it('keeps a complete upload even when the detections cannot be written', async () => {
    // A bookkeeping failure must not destroy a valid project.
    const stub = stubIngestFetch({ detectionInsert: jsonResponse({}, 500) });
    const result = await ingest({}, stub.fetchImpl);

    expect(result.ok).toBe(true);
    expect(stub.calls).not.toContain('project-delete');
  });
});

// @trace flow=intake.project-intent category=security
describe('what it refuses before touching either system', () => {
  it('refuses an SVG without writing anything', async () => {
    const stub = stubIngestFetch();
    const result = await ingest({ bytes: SVG_BYTES }, stub.fetchImpl);

    expect(result).toEqual({
      ok: false,
      failure: { kind: 'rejected', reason: 'unsupported_type' },
    });
    expect(stub.calls).toEqual([]);
  });

  it('refuses an undersized photograph without writing anything', async () => {
    const stub = stubIngestFetch();
    const result = await ingest({ bytes: pngBytes(400, 300) }, stub.fetchImpl);

    expect(result).toEqual({
      ok: false,
      failure: { kind: 'rejected', reason: 'below_min_dimension' },
    });
    expect(stub.calls).toEqual([]);
  });
});
