'use server';

import { type AuthProvider, createSupabaseAuthProvider, demoAuthProvider } from '@artloupe/auth';
import { signIn, signOut } from '@artloupe/auth/server';
import { env } from '@/env';
import { redirect } from '@/i18n/navigation';

export interface LoginState {
  error: boolean;
}

/**
 * Resolve the auth provider. Supabase artist auth (email/password) is the default;
 * `AUTH_PROVIDER=demo` swaps in the demo provider for the hermetic e2e run only.
 * Resolved lazily (not at module load) so the fail-closed throw lands on a login attempt,
 * not during the build.
 *
 * A `process.env.NODE_ENV === 'test'` guard was tried here and removed. Next **inlines**
 * `process.env.NODE_ENV` at build time, so in a production build the comparison is folded
 * away entirely — the compiled output became an unconditional `throw`, and the e2e run
 * (a production build served with `NODE_ENV=test`) could never reach the demo provider at
 * all. Serve-time `NODE_ENV` cannot gate build-time-inlined code. Do not re-add it.
 *
 * What holds the line instead: `AUTH_PROVIDER` defaults to `supabase`, so demo access
 * requires deliberately setting it *and* supplying `DEMO_AUTH_*`; and the Supabase branch
 * below fails closed rather than degrading. Deleting the branch outright needs a seeded
 * Supabase user in CI — the open follow-up in ADR 0002.
 */
const resolveAuthProvider = (): AuthProvider => {
  if (env.AUTH_PROVIDER === 'demo') {
    return demoAuthProvider;
  }

  // Fail closed: a Supabase deployment MUST supply its config rather than silently
  // degrading to demo access on this artist-facing surface.
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required for artist auth.');
  }

  return createSupabaseAuthProvider({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
};

/**
 * Artist login. Bound with the active locale by the form, then called by
 * `useActionState` as `(prevState, formData)`. Validates email + password against
 * Supabase Auth; on success it redirects to the gated home, on failure it returns
 * an error flag for the form to surface.
 */
export const login = async (
  locale: string,
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> => {
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');

  const result = await signIn({ username, password }, resolveAuthProvider());

  if (result.ok) {
    // redirect() throws NEXT_REDIRECT, so the return below is unreachable on success.
    redirect({ href: '/home', locale });
  }

  return { error: true };
};

/** Clear the session and return to the public landing page. */
export const logout = async (locale: string): Promise<void> => {
  await signOut();
  redirect({ href: '/', locale });
};
