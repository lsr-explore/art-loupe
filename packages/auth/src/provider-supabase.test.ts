import { beforeEach, describe, expect, it, vi } from 'vitest';

const signInWithPassword = vi.fn();
const refreshSession = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signInWithPassword, refreshSession } }),
}));

import { createSupabaseAuthProvider, createSupabaseTokenRefresher } from './provider-supabase';

const CONFIG = { url: 'http://127.0.0.1:54321', anonKey: 'anon-key' };

const supabaseSession = (overrides: Record<string, unknown> = {}) => ({
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_at: 1_800_000_000,
  ...overrides,
});

// @trace flow=platform.auth category=security
describe('createSupabaseAuthProvider', () => {
  const provider = createSupabaseAuthProvider(CONFIG);

  beforeEach(() => {
    signInWithPassword.mockReset();
  });

  it('resolves an artist session for valid credentials', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { email: 'alice@demo.artloupestudio.com' }, session: supabaseSession() },
      error: null,
    });

    const result = await provider.authenticate({
      username: 'alice@demo.artloupestudio.com',
      password: 'correct-horse',
    });

    expect(result?.user).toEqual({ username: 'alice@demo.artloupestudio.com', role: 'artist' });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'alice@demo.artloupestudio.com',
      password: 'correct-horse',
    });
  });

  it("relays Supabase's own tokens rather than minting any", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { email: 'alice@demo.artloupestudio.com' }, session: supabaseSession() },
      error: null,
    });

    const result = await provider.authenticate({
      username: 'alice@demo.artloupestudio.com',
      password: 'correct-horse',
    });

    expect(result?.tokens).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_800_000_000,
    });
  });

  it('reads the role from app_metadata', async () => {
    signInWithPassword.mockResolvedValue({
      data: {
        user: {
          email: 'ops@demo.artloupestudio.com',
          app_metadata: { artloupe_role: 'operator' },
        },
        session: supabaseSession(),
      },
      error: null,
    });

    const result = await provider.authenticate({
      username: 'ops@demo.artloupestudio.com',
      password: 'correct-horse',
    });

    expect(result?.user.role).toBe('operator');
  });

  it('ignores a role claimed in user_metadata', async () => {
    // `user_metadata` is writable by the user. Honouring a role there would let any artist
    // promote themselves to operator by editing their own profile.
    signInWithPassword.mockResolvedValue({
      data: {
        user: {
          email: 'alice@demo.artloupestudio.com',
          app_metadata: {},
          user_metadata: { artloupe_role: 'superuser' },
        },
        session: supabaseSession(),
      },
      error: null,
    });

    const result = await provider.authenticate({
      username: 'alice@demo.artloupestudio.com',
      password: 'correct-horse',
    });

    expect(result?.user.role).toBe('artist');
  });

  it('falls back to artist for an unrecognised role', async () => {
    signInWithPassword.mockResolvedValue({
      data: {
        user: { email: 'typo@demo.artloupestudio.com', app_metadata: { artloupe_role: 'oprator' } },
        session: supabaseSession(),
      },
      error: null,
    });

    const result = await provider.authenticate({
      username: 'typo@demo.artloupestudio.com',
      password: 'correct-horse',
    });

    expect(result?.user.role).toBe('artist');
  });

  it('returns null when Supabase rejects the credentials', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });

    const result = await provider.authenticate({
      username: 'alice@demo.artloupestudio.com',
      password: 'wrong',
    });

    expect(result).toBeNull();
  });

  it('returns null when no user is returned even without an error', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: null });

    const result = await provider.authenticate({
      username: 'nobody@demo.artloupestudio.com',
      password: 'whatever',
    });

    expect(result).toBeNull();
  });

  it('returns null when a user comes back without a session', async () => {
    // No session means no token, and a principal we cannot prove downstream is not a login.
    signInWithPassword.mockResolvedValue({
      data: { user: { email: 'alice@demo.artloupestudio.com' }, session: null },
      error: null,
    });

    const result = await provider.authenticate({
      username: 'alice@demo.artloupestudio.com',
      password: 'correct-horse',
    });

    expect(result).toBeNull();
  });
});

// @trace flow=platform.auth category=security
describe('createSupabaseTokenRefresher', () => {
  const refresher = createSupabaseTokenRefresher(CONFIG);

  beforeEach(() => {
    refreshSession.mockReset();
  });

  it('exchanges a refresh token for a fresh pair', async () => {
    refreshSession.mockResolvedValue({
      data: {
        session: supabaseSession({ access_token: 'new-access', refresh_token: 'new-refresh' }),
      },
      error: null,
    });

    const tokens = await refresher.refresh('refresh-token');

    expect(tokens).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: 1_800_000_000,
    });
    expect(refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh-token' });
  });

  it('returns null for a spent or revoked refresh token', async () => {
    // The caller destroys the session on null — a seal must not outlive its tokens.
    refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid Refresh Token' },
    });

    await expect(refresher.refresh('spent')).resolves.toBeNull();
  });

  it('treats a session with no expiry as already expired', async () => {
    // Failing closed: an unreadable expiry forces a refresh rather than granting an
    // accidentally immortal token.
    refreshSession.mockResolvedValue({
      data: { session: { access_token: 'access', refresh_token: 'refresh' } },
      error: null,
    });

    const tokens = await refresher.refresh('refresh-token');

    expect(tokens?.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });
});
