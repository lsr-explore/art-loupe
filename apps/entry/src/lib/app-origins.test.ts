import { describe, expect, it, vi } from 'vitest';

// The env module validates at import time; the defaults under test are the dev
// fallbacks, so the vars are deliberately absent here.
vi.mock('@/env', () => ({
  env: {
    NEXT_PUBLIC_STUDIO_URL: undefined,
    NEXT_PUBLIC_OPERATIONS_URL: undefined,
  },
}));

const { appOrigins, resolveNextUrl } = await import('./app-origins');

// @trace flow=platform.shell category=functionality
describe('appOrigins', () => {
  it('falls back to the dev ports when the env vars are unset', () => {
    expect(appOrigins()).toEqual({
      studio: 'http://localhost:3001',
      operations: 'http://localhost:3000',
    });
  });
});

/**
 * The `?next=` allowlist is the one piece of this ticket that is a
 * security boundary rather than a UX affordance: it takes an attacker-controlled
 * query parameter and turns it into a redirect. Everything below is a value that
 * has defeated a naive implementation of exactly this check somewhere.
 */
// @trace flow=platform.shell category=functionality
describe('resolveNextUrl', () => {
  it('accepts a URL on an allowed app origin and preserves its path', () => {
    expect(resolveNextUrl('http://localhost:3001/en/home')).toBe('http://localhost:3001/en/home');
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty string', ''],
  ])('returns null for %s', (_label, value) => {
    expect(resolveNextUrl(value)).toBeNull();
  });

  it('rejects an unrelated origin', () => {
    expect(resolveNextUrl('https://evil.test/steal')).toBeNull();
  });

  /**
   * The classic open-redirect. A `startsWith('http://localhost:3001')` check passes
   * this, because the attacker's host merely *begins* with our origin — the actual
   * origin is `localhost:3001.evil.test`. Parsing is what makes it fail.
   */
  it('rejects a host that only prefixes an allowed origin', () => {
    expect(resolveNextUrl('http://localhost:3001.evil.test/')).toBeNull();
  });

  it('rejects an allowed origin appearing later in the URL', () => {
    expect(resolveNextUrl('https://evil.test/?x=http://localhost:3001')).toBeNull();
  });

  it('rejects a protocol-relative URL', () => {
    // `new URL('//evil.test')` throws without a base, so this lands on the
    // unparseable path rather than resolving against the current origin.
    expect(resolveNextUrl('//evil.test')).toBeNull();
  });

  it('rejects a javascript: scheme', () => {
    // Parseable, but its origin is `null` and matches nothing on the allowlist.
    expect(resolveNextUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects a relative path', () => {
    // Meaningless here: entry and the apps are different origins, so a bare path
    // cannot identify a surface.
    expect(resolveNextUrl('/en/board')).toBeNull();
  });

  it('rejects the right host on the wrong port', () => {
    expect(resolveNextUrl('http://localhost:9999/en')).toBeNull();
  });
});
