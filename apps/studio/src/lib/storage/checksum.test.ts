import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHECKSUM_PATTERN, computeChecksum, isChecksum } from './checksum';

// @trace flow=intake.project-intent category=data
describe('computeChecksum', () => {
  it('produces the lowercase hex SHA-256 the database constraint accepts', () => {
    const checksum = computeChecksum(new TextEncoder().encode('a reference photograph'));

    expect(checksum).toMatch(CHECKSUM_PATTERN);
    expect(checksum).toBe(checksum.toLowerCase());
  });

  it('matches the published SHA-256 of the empty input', () => {
    // The one SHA-256 that can be checked against an external constant rather than against
    // this module's own output — which is the only way this suite catches a swapped digest.
    expect(computeChecksum(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('changes when a single byte changes', () => {
    const original = computeChecksum(Uint8Array.from([1, 2, 3, 4]));
    const altered = computeChecksum(Uint8Array.from([1, 2, 3, 5]));

    expect(altered).not.toBe(original);
  });

  it('is stable across calls, which is what makes it a cache key', () => {
    const bytes = Uint8Array.from([9, 8, 7, 6, 5]);

    expect(computeChecksum(bytes)).toBe(computeChecksum(bytes));
  });

  it('agrees with node:crypto over a payload larger than one hash block', () => {
    const bytes = new Uint8Array(200_000).map((_, index) => index % 251);

    expect(computeChecksum(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});

// @trace flow=intake.project-intent category=data
describe('isChecksum', () => {
  it('accepts a lowercase 64-character hex digest', () => {
    expect(isChecksum('a'.repeat(64))).toBe(true);
  });

  it('rejects uppercase hex, because the database constraint does', () => {
    expect(isChecksum('A'.repeat(64))).toBe(false);
  });

  it.each([
    ['too short', 'a'.repeat(63)],
    ['too long', 'a'.repeat(65)],
    ['non-hex', `${'a'.repeat(63)}z`],
    ['empty', ''],
    ['a signed URL', 'https://example.test/object/sign/reference-images/key?token=abc'],
  ])('rejects %s', (_label, candidate) => {
    expect(isChecksum(candidate)).toBe(false);
  });
});
