import type { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { ACK_COOKIE_NAME, acknowledgementRedirectUrl, hasAcknowledged } from './ack';

/** Minimal stand-in — middleware only ever reads `cookies` and `nextUrl`. */
const requestWith = ({ cookie, url }: { cookie?: string; url?: string }) =>
  ({
    cookies: {
      get: (name: string) => (cookie === name ? { name, value: '1' } : undefined),
    },
    nextUrl: new URL(url ?? 'http://localhost:3001/en/critique'),
  }) as unknown as NextRequest;

// @trace flow=platform.auth category=security
describe('hasAcknowledged', () => {
  it('is true when the cookie is present', () => {
    expect(hasAcknowledged(requestWith({ cookie: ACK_COOKIE_NAME }))).toBe(true);
  });

  it('is false when it is absent', () => {
    expect(hasAcknowledged(requestWith({}))).toBe(false);
  });

  it('does not accept the session cookie in its place', () => {
    expect(hasAcknowledged(requestWith({ cookie: 'artloupe_session' }))).toBe(false);
  });
});

// @trace flow=platform.auth category=security
describe('acknowledgementRedirectUrl', () => {
  it('sends the visitor to the entry point carrying an absolute next=', () => {
    const gate = acknowledgementRedirectUrl({
      request: requestWith({ url: 'http://localhost:3001/en/critique' }),
      entryOrigin: 'http://localhost:3003',
    });

    expect(gate.origin).toBe('http://localhost:3003');
    expect(gate.pathname).toBe('/');
    expect(gate.searchParams.get('next')).toBe('http://localhost:3001/en/critique');
  });

  it('preserves the deep link query string', () => {
    const gate = acknowledgementRedirectUrl({
      request: requestWith({ url: 'http://localhost:3001/en/critique?work=42' }),
      entryOrigin: 'http://localhost:3003',
    });

    expect(gate.searchParams.get('next')).toBe('http://localhost:3001/en/critique?work=42');
  });

  /**
   * Behind a TLS-terminating proxy the request's own origin is the internal
   * address, so a `next=` built from it would resume to somewhere unreachable.
   */
  it('prefers the configured public origin over the request origin', () => {
    const gate = acknowledgementRedirectUrl({
      request: requestWith({ url: 'http://10.0.0.7:3001/en/critique' }),
      entryOrigin: 'https://artloupestudio.com',
      appOrigin: 'https://studio.artloupestudio.com',
    });

    expect(gate.searchParams.get('next')).toBe('https://studio.artloupestudio.com/en/critique');
  });
});

/**
 * The entry point re-exports `ACK_COOKIE_NAME` from here rather than declaring its
 * own, so writer and readers cannot disagree. There is deliberately no test pinning
 * the two equal — with one declaration there is nothing to pin, and a test asserting
 * a value equals itself would only look like coverage.
 */
// @trace flow=platform.auth category=security
describe('the ack cookie name is declared once', () => {
  it('is the name the entry point writes and the apps read', () => {
    expect(ACK_COOKIE_NAME).toBe('artloupe_ack');
  });
});
