import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildReferenceImageKey,
  parseReferenceImageKey,
  REFERENCE_IMAGE_BUCKET,
} from './reference-images';

// Hex letters in both, so `toUpperCase()` below actually changes the string.
const OWNER_ID = 'a1b2c3d4-1111-4111-8111-1111111111ab';
const PROJECT_ID = 'e5f60718-2222-4222-8222-2222222222cd';
const CHECKSUM = 'c'.repeat(64);

// @trace flow=intake.project-intent category=security
describe('buildReferenceImageKey', () => {
  it('puts the owner id first, which is the segment the storage policy matches on', () => {
    const key = buildReferenceImageKey({
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      checksum: CHECKSUM,
    });

    expect(key.split('/')[0]).toBe(OWNER_ID);
    expect(key).toBe(`${OWNER_ID}/${PROJECT_ID}/${CHECKSUM}`);
  });

  it('ends with the checksum, which is what the source_images constraint requires', () => {
    const key = buildReferenceImageKey({
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      checksum: CHECKSUM,
    });

    expect(key.endsWith(`/${CHECKSUM}`)).toBe(true);
  });

  it.each([
    ['a traversal segment', '../../22222222-2222-4222-8222-222222222222'],
    ['another artist behind a separator', `${OWNER_ID}/${OWNER_ID}`],
    ['an empty id', ''],
    ['a non-uuid', 'not-a-uuid'],
  ])('refuses %s as an owner id', (_label, ownerId) => {
    expect(() =>
      buildReferenceImageKey({ ownerId, projectId: PROJECT_ID, checksum: CHECKSUM }),
    ).toThrow(/ownerId/);
  });

  it('refuses a project id that would walk out of the owner prefix', () => {
    expect(() =>
      buildReferenceImageKey({ ownerId: OWNER_ID, projectId: '../other', checksum: CHECKSUM }),
    ).toThrow(/projectId/);
  });

  it('refuses a checksum that is not lowercase hex SHA-256', () => {
    expect(() =>
      buildReferenceImageKey({
        ownerId: OWNER_ID,
        projectId: PROJECT_ID,
        checksum: CHECKSUM.toUpperCase(),
      }),
    ).toThrow(/checksum/);
  });
});

// @trace flow=intake.project-intent category=security
describe('parseReferenceImageKey', () => {
  it('round-trips a key it built', () => {
    const key = buildReferenceImageKey({
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      checksum: CHECKSUM,
    });

    expect(parseReferenceImageKey(key)).toEqual({
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      checksum: CHECKSUM,
    });
  });

  it.each([
    ['a traversal', `${OWNER_ID}/../${PROJECT_ID}/${CHECKSUM}`],
    ['too few segments', `${OWNER_ID}/${CHECKSUM}`],
    ['too many segments', `${OWNER_ID}/${PROJECT_ID}/nested/${CHECKSUM}`],
    ['a leading slash', `/${OWNER_ID}/${PROJECT_ID}/${CHECKSUM}`],
    ['a non-uuid owner', `nobody/${PROJECT_ID}/${CHECKSUM}`],
    ['a bad checksum', `${OWNER_ID}/${PROJECT_ID}/nope`],
    ['nothing at all', ''],
    // Passes the UUID pattern, but would never match `auth.uid()::text` in the policy.
    ['an uppercase owner id', `${OWNER_ID.toUpperCase()}/${PROJECT_ID}/${CHECKSUM}`],
  ])('returns null for %s rather than throwing', (_label, key) => {
    expect(parseReferenceImageKey(key)).toBeNull();
  });
});

// @trace flow=intake.project-intent category=security
describe('REFERENCE_IMAGE_BUCKET', () => {
  // Renaming the constant without editing the migration writes originals into a bucket that
  // has no policies on it at all. Nothing would warn: the write succeeds, and the artist
  // simply cannot read their own upload back. So the constant is checked against the SQL
  // rather than against itself.
  const migration = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../supabase/migrations/20260905183000_create_projects_and_reference_images.sql',
    ),
    'utf8',
  );

  it('names the bucket the migration creates', () => {
    expect(migration).toContain(`values (\n    '${REFERENCE_IMAGE_BUCKET}',`);
  });

  it('names the bucket every storage policy is scoped to', () => {
    const scopes = migration.match(/bucket_id = '[^']+'/g) ?? [];

    expect(scopes.length).toBeGreaterThan(0);
    expect(new Set(scopes)).toEqual(new Set([`bucket_id = '${REFERENCE_IMAGE_BUCKET}'`]));
  });
});
