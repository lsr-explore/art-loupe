import { afterEach, describe, expect, it } from 'vitest';
import { getSessionOptions, SESSION_COOKIE_NAME } from './options';

// @trace flow=platform.auth category=security
describe('getSessionOptions', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns options with the cookie name and provided password', () => {
    process.env.AUTH_SESSION_PASSWORD = 'a'.repeat(32);

    const options = getSessionOptions();

    expect(options.cookieName).toBe(SESSION_COOKIE_NAME);
    expect(options.password).toHaveLength(32);
    expect(options.cookieOptions?.httpOnly).toBe(true);
    expect(options.cookieOptions?.sameSite).toBe('lax');
  });

  it('throws when the password is missing', () => {
    process.env.AUTH_SESSION_PASSWORD = undefined;

    expect(() => getSessionOptions()).toThrow('at least 32 characters');
  });

  it('throws when the password is too short', () => {
    process.env.AUTH_SESSION_PASSWORD = 'short';

    expect(() => getSessionOptions()).toThrow('at least 32 characters');
  });
  it("defaults to an eight-hour session rather than iron-session's fourteen days", () => {
    process.env.AUTH_SESSION_PASSWORD = 'a'.repeat(32);
    process.env.AUTH_SESSION_TTL = undefined;

    expect(getSessionOptions().ttl).toBe(60 * 60 * 8);
  });

  it('lets an app shorten the session via AUTH_SESSION_TTL', () => {
    process.env.AUTH_SESSION_PASSWORD = 'a'.repeat(32);
    process.env.AUTH_SESSION_TTL = '3600';

    expect(getSessionOptions().ttl).toBe(3600);
  });

  it('refuses a zero TTL, which iron-session reads as "never expires"', () => {
    process.env.AUTH_SESSION_PASSWORD = 'a'.repeat(32);
    process.env.AUTH_SESSION_TTL = '0';

    expect(() => getSessionOptions()).toThrow('positive whole number of seconds');
  });

  it('refuses a non-numeric TTL rather than silently falling back', () => {
    process.env.AUTH_SESSION_PASSWORD = 'a'.repeat(32);
    process.env.AUTH_SESSION_TTL = 'forever';

    expect(() => getSessionOptions()).toThrow('positive whole number of seconds');
  });
});
