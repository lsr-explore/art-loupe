import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthProvider } from './provider';
import type { SessionData } from './types';

// `server-only` throws outside a React Server Component; the module under test is
// server code either way, so the marker is stubbed rather than the behaviour changed.
vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({}),
}));

const sessionStore = vi.hoisted(() => ({
  data: {} as SessionData & { save: () => Promise<void>; destroy: () => void },
}));

vi.mock('iron-session', () => ({
  getIronSession: () => Promise.resolve(sessionStore.data),
}));

import { signIn } from './server';

const providerFor = (role: 'artist' | 'operator' | 'superuser'): AuthProvider => ({
  authenticate: () => Promise.resolve({ user: { username: 'someone@example.test', role } }),
});

const rejectingProvider: AuthProvider = {
  authenticate: () => Promise.resolve(null),
};

const save = vi.fn();
const destroy = vi.fn();

// @trace flow=platform.auth category=security
describe('signIn', () => {
  beforeEach(() => {
    save.mockReset();
    destroy.mockReset();
    process.env.AUTH_SESSION_PASSWORD = 'a'.repeat(32);
    sessionStore.data = { save, destroy } as typeof sessionStore.data;
  });

  it('persists the session for an accepted principal', async () => {
    const result = await signIn(
      { username: 'someone@example.test', password: 'pw' },
      providerFor('artist'),
    );

    expect(result.ok).toBe(true);
    expect(sessionStore.data.user).toEqual({ username: 'someone@example.test', role: 'artist' });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('refuses invalid credentials without writing a session', async () => {
    const result = await signIn(
      { username: 'someone@example.test', password: 'wrong' },
      rejectingProvider,
    );

    expect(result.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('admits a principal whose role is on the allow list', async () => {
    const result = await signIn(
      { username: 'ops@example.test', password: 'pw' },
      providerFor('operator'),
      { allowRoles: ['operator', 'superuser'] },
    );

    expect(result.ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  /**
   * The control this option exists for. An artist with entirely valid Supabase
   * credentials must not obtain an operations session — and critically, must not obtain
   * one that a later route guard then has to revoke.
   */
  it('refuses a valid principal whose role is not on the allow list', async () => {
    const result = await signIn(
      { username: 'artist@example.test', password: 'correct-horse' },
      providerFor('artist'),
      { allowRoles: ['operator', 'superuser'] },
    );

    expect(result.ok).toBe(false);
  });

  it('writes no session at all for a refused role', async () => {
    await signIn(
      { username: 'artist@example.test', password: 'correct-horse' },
      providerFor('artist'),
      {
        allowRoles: ['operator'],
      },
    );

    expect(save).not.toHaveBeenCalled();
    expect(sessionStore.data.user).toBeUndefined();
  });

  // A refused role and a wrong password are indistinguishable to the caller. Reporting
  // them differently would confirm a valid account to anyone probing the operations login.
  it('reports a refused role identically to a bad password', async () => {
    const wrongPassword = await signIn(
      { username: 'a@example.test', password: 'no' },
      rejectingProvider,
    );
    const wrongRole = await signIn(
      { username: 'b@example.test', password: 'yes' },
      providerFor('artist'),
      {
        allowRoles: ['operator'],
      },
    );

    expect(wrongRole).toEqual(wrongPassword);
  });

  it('accepts any authenticated role when no allow list is given', async () => {
    const result = await signIn(
      { username: 'a@example.test', password: 'pw' },
      providerFor('artist'),
    );

    expect(result.ok).toBe(true);
  });
});
