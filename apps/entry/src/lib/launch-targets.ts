/**
 * The launchable surfaces, in the order the panels render them.
 *
 * These live apart from `app-origins.ts` on purpose, and the split is load-bearing
 * rather than tidiness. `app-origins.ts` imports `@/env`, which pulls in
 * `@t3-oss/env-nextjs` and Zod. `launch-panels.tsx` is a client component and needs
 * only this const and its type — importing them from `app-origins` dragged the whole
 * env-validation runtime across the server/client boundary and shipped Zod plus its
 * localized error catalog to the browser: a single 92 kB gzipped chunk on a page that
 * renders two links.
 *
 * Keep this module free of imports. Anything that reads `env` belongs in
 * `app-origins.ts`, which only server code may import.
 */
export const LAUNCH_TARGETS = ['studio', 'operations'] as const;

export type LaunchTarget = (typeof LAUNCH_TARGETS)[number];
