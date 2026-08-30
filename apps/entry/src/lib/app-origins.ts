import { env } from '@/env';
import type { LaunchTarget } from '@/lib/launch-targets';

/**
 * Dev ports, matching the `pnpm dev` assignments (entry itself is 3003).
 *
 * These are fallbacks, not configuration: every deployed environment sets the
 * `NEXT_PUBLIC_*_URL` vars. They exist so a fresh clone runs with no `.env.local`.
 */
const DEV_ORIGINS: Record<LaunchTarget, string> = {
  studio: 'http://localhost:3001',
  operations: 'http://localhost:3000',
};

/**
 * Resolved origin per surface, normalised through `URL` so a trailing slash or a
 * stray path in the env value cannot produce `https://host.com//en` downstream.
 */
export const appOrigins = (): Record<LaunchTarget, string> => ({
  studio: new URL(env.NEXT_PUBLIC_STUDIO_URL ?? DEV_ORIGINS.studio).origin,
  operations: new URL(env.NEXT_PUBLIC_OPERATIONS_URL ?? DEV_ORIGINS.operations).origin,
});

/**
 * Validates a `?next=` value against the app origins.
 *
 * Returns the URL to resume to, or `null` when the value is absent, unparseable,
 * or points anywhere we do not own — in which case the caller falls back to the
 * panel grid rather than following it.
 *
 * Comparison is on the parsed `origin`, never on string prefixes. A
 * `startsWith(allowed)` check is the classic open-redirect: it passes
 * `https://studio.artloupestudio.com.attacker.test/`, whose origin is plainly the
 * attacker's. Parsing also rejects `javascript:` and protocol-relative `//evil`
 * on the same code path, since neither yields a matching origin.
 */
export const resolveNextUrl = (next: string | null | undefined): string | null => {
  if (!next) {
    return null;
  }

  let candidate: URL;
  try {
    candidate = new URL(next);
  } catch {
    // Relative values land here. They are meaningless to us — the entry point and
    // the apps are different origins, so a bare path could not identify a surface.
    return null;
  }

  const allowed = Object.values(appOrigins());
  return allowed.includes(candidate.origin) ? candidate.toString() : null;
};
