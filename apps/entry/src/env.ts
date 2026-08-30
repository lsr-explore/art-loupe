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

    /**
     * `Domain` for the acknowledgement cookie — e.g. `.artloupestudio.com`, so
     * all three app subdomains can read what the apex sets.
     *
     * Deliberately optional, and deliberately *unset* in development. Cookies ignore
     * the port, so on localhost the four surfaces already share one cookie jar as a
     * plain host-only cookie; setting a literal `.artloupestudio.com` there would have
     * the browser reject the `Set-Cookie` outright as a domain mismatch, and the gate
     * would silently never engage. Leave unset locally, set it at deploy.
     */
    ACK_COOKIE_DOMAIN: z.string().optional(),
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
     * Origins of the three app surfaces the launch panels point at.
     *
     * These serve double duty: they are the panel hrefs *and* the allowlist the
     * `?next=` handoff is validated against, so a deep link that
     * bounced here can only ever resume to one of our own surfaces. Keeping one
     * source for both means a new surface cannot become launchable without also
     * becoming a legal redirect target, or vice versa.
     */
    NEXT_PUBLIC_STUDIO_URL: z.url().optional(),
    NEXT_PUBLIC_OPERATIONS_URL: z.url().optional(),
  },

  /**
   * Runtime values — must match the keys defined above.
   * Destructure from process.env so Next.js can statically replace them.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    ACK_COOKIE_DOMAIN: process.env.ACK_COOKIE_DOMAIN,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_STUDIO_URL: process.env.NEXT_PUBLIC_STUDIO_URL,
    NEXT_PUBLIC_OPERATIONS_URL: process.env.NEXT_PUBLIC_OPERATIONS_URL,
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
