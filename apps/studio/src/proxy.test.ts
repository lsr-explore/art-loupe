// @vitest-environment node
// Middleware runs on the server, and `next-intl/middleware` resolves `next/server` through
// node export conditions — under the suite's default jsdom environment that resolution
// fails outright. This is the one file in the app with no DOM in it.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Role } from '@artloupe/auth';
import { ACK_COOKIE_NAME } from '@artloupe/auth/ack';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Topology test for the middleware gate chain — the frontend counterpart to the agent's
 * `test_graph_topology.py`.
 *
 * `proxy.ts` is this app's guard node: an ordered chain (locale → acknowledgement → auth →
 * role) where the **order** carries the safety property, not any single branch. A page
 * added under `app/[locale]/` inherits gating implicitly from the matcher, so the failure
 * mode is silent in both directions — a new route can arrive ungated without anyone
 * writing a line of code that looks wrong, and a reordering can move the acknowledgement
 * behind the login without changing any single route's final destination.
 *
 * Same two-layer split as the Python topology test:
 *
 * 1. The **matrix snapshot** enumerates routes off disk rather than from a hand-written
 *    list, so a new page cannot join the app without appearing as a diff. Regenerable with
 *    `-u`, which makes it good at catching accidents and useless against a careless update.
 * 2. The **invariant tests** below it state the properties directly and have no update
 *    path. `vitest -u` does not quiet them.
 */

const session = vi.hoisted(() => ({ current: null as { role: Role } | null }));

vi.mock('@artloupe/auth/middleware', () => ({
  getSessionFromRequest: async () => session.current,
}));

/**
 * Locale negotiation is stubbed to a pass-through.
 *
 * Two reasons, one principled and one practical. Principled: the subject here is the
 * first-party gate chain, and next-intl's locale handling is third-party behaviour
 * with its own tests. Practical: under pnpm's strict linking, vitest cannot resolve
 * `next/server` from inside `next-intl`'s own tree.
 *
 * Every request below is already locale-prefixed, so the real middleware would return
 * `next()` here too — the stub is behaviourally equivalent for this matrix. What it does
 * *not* cover is `proxy.ts`'s early return on a locale redirect (the `/` → `/en` hop);
 * that path is exercised by the e2e suite against a real server.
 */
vi.mock('next-intl/middleware', () => ({
  default: () => () => NextResponse.next(),
}));

const { proxy } = await import('./proxy');

const APP_ORIGIN = 'http://localhost:3000';
/** `proxy.ts` falls back to this when `NEXT_PUBLIC_ENTRY_URL` is unset, as it is here. */
const ENTRY_ORIGIN = 'http://localhost:3003';
const LOCALE = 'en';

/**
 * Route segments discovered from the App Router tree, not hand-listed. Reading the
 * filesystem is the whole point: a hand-maintained list would silently stop covering the
 * app the first time someone adds a page, which is precisely the regression this guards.
 */
const discoverRoutes = (): string[] => {
  const localeDir = fileURLToPath(new URL('./app/[locale]', import.meta.url));
  const segments = readdirSync(localeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  // '' is the landing page (`app/[locale]/page.tsx`) — the one intentionally public path.
  return ['', ...segments];
};

interface Visitor {
  label: string;
  role: Role | null;
  acknowledged: boolean;
}

const VISITORS: Visitor[] = [
  { label: 'anonymous', role: null, acknowledged: true },
  { label: 'artist', role: 'artist', acknowledged: true },
  // An operator cookie must not open the studio: the apps are deliberately separated
  // (`ALLOWED_ROLES`), so this column existing and reading "login" is the test.
  { label: 'operator', role: 'operator', acknowledged: true },
  { label: 'superuser', role: 'superuser', acknowledged: true },
  // Authenticated but has not acknowledged — the column that pins gate *order*.
  { label: 'artist, no ack', role: 'artist', acknowledged: false },
  // Unauthenticated *and* unacknowledged, which is the only combination that can tell the
  // two gates apart: reorder them and this column flips from the entry point to the login
  // screen while every other cell in the matrix stays put. It was missing from the first
  // draft of this table, and a reordering refactor slipped through the snapshot because of
  // it — the invariant test below caught what the matrix did not.
  { label: 'anonymous, no ack', role: null, acknowledged: false },
];

const requestFor = (route: string, visitor: Visitor): NextRequest => {
  const url = route ? `${APP_ORIGIN}/${LOCALE}/${route}` : `${APP_ORIGIN}/${LOCALE}`;
  const request = new NextRequest(new URL(url));
  if (visitor.acknowledged) {
    request.cookies.set(ACK_COOKIE_NAME, '1');
  }
  return request;
};

/**
 * Collapse a middleware response to one of four outcomes.
 *
 * The acknowledgement redirect carries a `?next=` absolute URL, which would make the
 * snapshot churn on any origin change; the outcome vocabulary is what the reviewer
 * actually needs to read, so it is normalised here rather than asserted verbatim.
 */
const outcomeOf = (location: string | null): string => {
  if (location === null) return 'render';
  if (location.startsWith(ENTRY_ORIGIN)) return 'redirect → entry (acknowledgement gate)';
  const { pathname } = new URL(location, APP_ORIGIN);
  if (pathname === `/${LOCALE}`) return 'redirect → /en (login)';
  if (pathname === `/${LOCALE}/home`) return 'redirect → /en/home';
  return `redirect → ${pathname}`;
};

const gateFor = async (route: string, visitor: Visitor): Promise<string> => {
  session.current = visitor.role ? { role: visitor.role } : null;
  const response = await proxy(requestFor(route, visitor));
  return outcomeOf(response.headers.get('location'));
};

const ROUTES = discoverRoutes();

// @trace flow=platform.auth category=security
describe('Studio middleware gate chain', () => {
  beforeEach(() => {
    session.current = null;
  });

  it('matches the committed route × visitor gate matrix', async () => {
    const header = `| Route | ${VISITORS.map((visitor) => visitor.label).join(' | ')} |`;
    const divider = `| --- | ${VISITORS.map(() => '---').join(' | ')} |`;

    const rows: string[] = [];
    for (const route of ROUTES) {
      const cells: string[] = [];
      for (const visitor of VISITORS) {
        cells.push(await gateFor(route, visitor));
      }
      rows.push(`| \`/${LOCALE}${route ? `/${route}` : ''}\` | ${cells.join(' | ')} |`);
    }

    const matrix = [
      '# Studio route × visitor gate matrix',
      '',
      'GENERATED by `src/proxy.test.ts` — update with `pnpm --filter @artloupe/studio test -u`.',
      'A new row means a new route joined the app: check its columns before accepting the diff.',
      '',
      header,
      divider,
      ...rows,
      '',
    ].join('\n');

    await expect(matrix).toMatchFileSnapshot('./__snapshots__/route-gate-matrix.md');
  });

  // The invariants. These restate the safety properties directly, so regenerating the
  // snapshot above cannot make a real regression pass.

  it('admits no anonymous visitor to any route but the landing', async () => {
    const anonymous = VISITORS[0];
    const reached: string[] = [];

    for (const route of ROUTES.filter(Boolean)) {
      if ((await gateFor(route, anonymous)) === 'render') {
        reached.push(route);
      }
    }

    expect(
      reached,
      `${reached.join(', ')} rendered for an anonymous visitor. Every path but the landing ` +
        'is artist-scoped; a route that renders without a session has left the gate.',
    ).toEqual([]);
  });

  it('applies the acknowledgement gate before the auth gate', async () => {
    // The ordering property, and the one a reordering refactor breaks silently: a visitor
    // who is *both* unauthenticated and unacknowledged must reach the entry point, never
    // this app's login. Both outcomes are redirects and no route changes reachability, so
    // nothing else in the suite moves — swapping the two `if` blocks in `proxy.ts` leaves
    // every other test in this app green.
    const visitor = VISITORS.find((candidate) => candidate.label === 'anonymous, no ack');
    if (!visitor) throw new Error('the unauthenticated, unacknowledged visitor left the matrix');

    expect(await gateFor('home', visitor)).toBe('redirect → entry (acknowledgement gate)');
  });

  it('refuses an operator session rather than treating it as authorized', async () => {
    const operator = VISITORS.find((visitor) => visitor.label === 'operator');
    if (!operator) throw new Error('operator visitor missing from the matrix');

    expect(await gateFor('home', operator)).toBe('redirect → /en (login)');
  });
});
