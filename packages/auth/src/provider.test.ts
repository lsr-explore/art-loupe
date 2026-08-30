import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { demoAuthProvider } from './provider';

// @trace flow=platform.auth category=security
describe('demoAuthProvider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DEMO_AUTH_USERNAME = 'demo-user';
    process.env.DEMO_AUTH_PASSWORD = 'demo-pass';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('resolves a super-user session for matching credentials', async () => {
    const result = await demoAuthProvider.authenticate({
      username: 'demo-user',
      password: 'demo-pass',
    });

    expect(result).toEqual({ user: { username: 'demo-user', role: 'superuser' } });
  });

  it('issues no tokens, so a demo session cannot reach the Python services', async () => {
    const result = await demoAuthProvider.authenticate({
      username: 'demo-user',
      password: 'demo-pass',
    });

    expect(result?.tokens).toBeUndefined();
  });

  it('returns null for a wrong password', async () => {
    const result = await demoAuthProvider.authenticate({
      username: 'demo-user',
      password: 'nope',
    });

    expect(result).toBeNull();
  });

  it('returns null for an unknown username', async () => {
    const result = await demoAuthProvider.authenticate({
      username: 'someone-else',
      password: 'demo-pass',
    });

    expect(result).toBeNull();
  });

  it('rejects a password sharing a long prefix with the real one', async () => {
    // The case a short-circuiting `===` leaks through response timing. The assertion here
    // is only that it is refused; timing itself is not measurable in a unit test, so the
    // guarantee lives in `constantTimeEquals` rather than in this expectation.
    const result = await demoAuthProvider.authenticate({
      username: 'demo-user',
      password: 'demo-pasx',
    });

    expect(result).toBeNull();
  });

  it('throws when the demo credentials are not configured', async () => {
    process.env.DEMO_AUTH_USERNAME = undefined;
    process.env.DEMO_AUTH_PASSWORD = undefined;

    await expect(
      demoAuthProvider.authenticate({ username: 'demo-user', password: 'demo-pass' }),
    ).rejects.toThrow('DEMO_AUTH_USERNAME and DEMO_AUTH_PASSWORD must be set.');
  });
});
