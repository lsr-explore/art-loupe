import { describe, expect, it } from 'vitest';
import { subjectFromAccessToken } from './claims';
import {
  SUBJECT,
  UNICODE_CLAIMS_TOKEN,
  UNREADABLE_TOKENS,
  UPPERCASE_SUBJECT_TOKEN,
  VALID_TOKEN,
} from './claims.fixtures';

// @trace flow=platform.auth category=security
describe('subjectFromAccessToken', () => {
  it('reads the sub claim', () => {
    expect(subjectFromAccessToken(VALID_TOKEN)).toBe(SUBJECT);
  });

  it('lowercases the subject', () => {
    // The value becomes the leading segment of a storage object key, and the storage policy
    // compares it to `auth.uid()::text`, which Postgres renders lowercase. Returning it as
    // written would build a key its own owner cannot read — and `parseReferenceImageKey`
    // refuses uppercase keys outright, so the failure would surface far from its cause.
    expect(subjectFromAccessToken(UPPERCASE_SUBJECT_TOKEN)).toBe(SUBJECT);
  });

  it('survives multi-byte claims alongside the subject', () => {
    // `atob` yields one character per byte. Reading its output directly would mangle any
    // non-ASCII claim and, worse, could throw part-way and lose a token that was fine.
    expect(subjectFromAccessToken(UNICODE_CLAIMS_TOKEN)).toBe(SUBJECT);
  });

  it.each(Object.entries(UNREADABLE_TOKENS))('answers null for a %s', (_label, token) => {
    expect(subjectFromAccessToken(token)).toBeNull();
  });

  it('never throws, whatever it is handed', () => {
    // The caller's next move is identical for every failure, so a throw would only mean an
    // unhandled rejection inside a route handler that already had an answer available.
    for (const token of Object.values(UNREADABLE_TOKENS)) {
      expect(() => subjectFromAccessToken(token)).not.toThrow();
    }
  });
});
