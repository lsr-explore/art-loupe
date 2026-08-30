import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

export const env = createEnv({
  /**
   * Server-side environment variables — not exposed to the browser.
   * Validated at build time.
   */
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    // Auth provider selector. Defaults to Supabase operator auth (email/password).
    // `demo` swaps in the single-super-user demo provider and is intended ONLY for the
    // hermetic e2e run — the login action refuses it outside NODE_ENV=test.
    AUTH_PROVIDER: z.enum(['supabase', 'demo']).default('supabase'),
    // Supabase Auth — operator email/password sign-in. The anon key is sufficient for
    // password auth; the service-role key is never read by the app (only the offline
    // seed script uses it, to write the `operator` role into app_metadata). Optional in
    // the schema so the `demo` provider can run without them; the login action requires
    // them for `supabase`.
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_ANON_KEY: z.string().min(1).optional(),
  },

  /**
   * Client-side environment variables — must be prefixed with NEXT_PUBLIC_.
   * Exposed to the browser bundle.
   */
  client: {
    /**
     * Public origin for this surface. Validated here rather than read raw, because
     * `new URL()` in the layout's `metadataBase` throws a bare `TypeError: Invalid URL`
     * at module evaluation for a malformed value — e.g. `localhost:3003` with no
     * protocol — which takes the app down at boot with no indication of the cause.
     */
    NEXT_PUBLIC_APP_URL: z.url().optional(),

    /**
     * Origin of the entry-point surface, which hosts the single canonical About site.
     * The shared footer links there cross-origin rather than each app shipping
     * its own translated copy. Unset, the layout falls back to
     * the local entry app on :3003.
     */
    NEXT_PUBLIC_ENTRY_URL: z.url().optional(),
  },

  /**
   * Runtime values — must match the keys defined above.
   * Destructure from process.env so Next.js can statically replace them.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    AUTH_PROVIDER: process.env.AUTH_PROVIDER,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ENTRY_URL: process.env.NEXT_PUBLIC_ENTRY_URL,
  },

  /**
   * Skip validation in environments where env vars aren't available
   * (e.g., Docker builds, CI linting steps).
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

  /**
   * Treat empty strings as undefined so missing vars are caught.
   */
  emptyStringAsUndefined: true,
});
