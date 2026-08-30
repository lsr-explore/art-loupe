import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signIn = vi.fn();
vi.mock('@artloupe/auth/server', () => ({
  signIn: (...args: unknown[]) => signIn(...args),
  signOut: vi.fn(),
}));

const createSupabaseAuthProvider = vi.fn((_config: unknown) => ({ kind: 'supabase' }));
vi.mock('@artloupe/auth', () => ({
  createSupabaseAuthProvider: (config: unknown) => createSupabaseAuthProvider(config),
  demoAuthProvider: { kind: 'demo' },
}));

vi.mock('@/i18n/navigation', () => ({
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
}));

const envValues = vi.hoisted(() => ({
  current: {
    AUTH_PROVIDER: 'supabase',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: 'anon-key',
  } as Record<string, string | undefined>,
}));

vi.mock('@/env', () => ({
  get env() {
    return envValues.current;
  },
}));

import { login } from './actions';

const attempt = (username = 'ops@demo.artloupestudio.com', password = 'pw') => {
  const formData = new FormData();
  formData.set('username', username);
  formData.set('password', password);
  return login('en', { error: false }, formData);
};

// @trace flow=platform.auth category=security
describe('operations login', () => {
  beforeEach(() => {
    signIn.mockReset();
    signIn.mockResolvedValue({ ok: false });
    createSupabaseAuthProvider.mockClear();
    envValues.current = {
      AUTH_PROVIDER: 'supabase',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'anon-key',
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('authenticates against Supabase by default', async () => {
    await attempt();

    expect(createSupabaseAuthProvider).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:54321',
      anonKey: 'anon-key',
    });
  });

  /**
   * The console is operator-only. Passing the allow list to `signIn` is what stops a
   * valid artist account from receiving a session here at all, rather than being let in
   * and bounced by a route guard afterwards.
   */
  it('restricts sign-in to operator roles', async () => {
    await attempt();

    expect(signIn).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      allowRoles: ['operator', 'superuser'],
    });
  });

  it('surfaces an error when the credentials or role are refused', async () => {
    signIn.mockResolvedValue({ ok: false });

    await expect(attempt()).resolves.toEqual({ error: true });
  });

  it('redirects to the gated home on success', async () => {
    signIn.mockResolvedValue({ ok: true });

    await expect(attempt()).rejects.toThrow('NEXT_REDIRECT');
  });

  // `AUTH_PROVIDER` is the whole control on the demo path — a `NODE_ENV` guard cannot
  // work here, because Next inlines `process.env.NODE_ENV` at build time (see the note in
  // actions.ts). The hermetic e2e run selects the demo provider this way.
  it('uses the demo provider only when AUTH_PROVIDER asks for it', async () => {
    envValues.current = { AUTH_PROVIDER: 'demo' };

    await attempt();

    expect(signIn).toHaveBeenCalledWith(expect.anything(), { kind: 'demo' }, expect.anything());
  });

  // The role gate still applies to the demo provider, so it is not a way around
  // operator-only access even when it is deliberately enabled.
  it('still restricts roles when the demo provider is in use', async () => {
    envValues.current = { AUTH_PROVIDER: 'demo' };

    await attempt();

    expect(signIn).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      allowRoles: ['operator', 'superuser'],
    });
  });

  it('fails closed when Supabase is not configured', async () => {
    envValues.current = { AUTH_PROVIDER: 'supabase' };

    await expect(attempt()).rejects.toThrow('required for operator auth');
  });
});
