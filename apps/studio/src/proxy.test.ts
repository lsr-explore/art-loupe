// @vitest-environment node
// Middleware runs on the server, and `next-intl/middleware` resolves `next/server` through
// node export conditions — under the suite's default jsdom environment that resolution
// fails outright. This is the one file in the app with no DOM in it.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
 *
 * It walks for `page.tsx` rather than listing the directories directly beneath `[locale]`,
 * for the same reason `discoverApiRoutes` walks for `route.ts`. Listing directories was
 * right while every page was one segment deep and became wrong the moment one was not: a
 * nested page (`projects/new`) would have been reported as its parent, and a directory that
 * groups routes without being one itself (`projects/`) would have appeared in the matrix as
 * a path that does not exist. Both failures point the same way — the row a reviewer reads
 * would stop naming the route that was actually gated.
 */
const discoverRoutes = (): string[] => {
  const localeDir = fileURLToPath(new URL('./app/[locale]', import.meta.url));
  const found: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name === 'page.tsx') {
        found.push(prefix);
      }
    }
  };

  // '' is the landing page (`app/[locale]/page.tsx`) — the one intentionally public path.
  walk(localeDir, '');
  return found.sort();
};

/**
 * Route handlers discovered from `app/api`, by the same principle as the pages above: read
 * them off disk, so a handler cannot join the app without showing up as a row here.
 *
 * This matters more for handlers than for pages. A page that arrives ungated is at least
 * visible to anyone who loads it; a handler is reached by script, returns JSON, and the first
 * evidence that it was never gated is the data already having left. `api` was excluded from
 * `config.matcher` outright until this PR, so every handler added before now would have been
 * invisible to the middleware *and* to this test.
 */
const discoverApiRoutes = (): string[] => {
  const apiDir = fileURLToPath(new URL('./app/api', import.meta.url));
  if (!existsSync(apiDir)) {
    return [];
  }

  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${prefix}/${entry.name}`);
      } else if (entry.name === 'route.ts') {
        found.push(prefix);
      }
    }
  };

  walk(apiDir, '/api');
  return found.sort();
};

/**
 * A concrete request path for a route pattern.
 *
 * The middleware only looks at the `/api` prefix, so the substituted values are arbitrary —
 * but they have to be *something*, because `NextRequest` needs a real URL.
 */
const concretePathFor = (pattern: string): string =>
  pattern.replace(/\[\.\.\.[^\]]+\]/g, 'catch/all/segments').replace(/\[[^\]]+\]/g, 'value');

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
  // A route beginning `/api` is already an absolute path and carries no locale segment.
  // Pages go through `concretePathFor` too — a dynamic page segment (`projects/[id]`) is a
  // pattern, and `new URL()` would carry the brackets through as percent-encoded path text.
  const path = route.startsWith('/api')
    ? concretePathFor(route)
    : route
      ? `/${LOCALE}/${concretePathFor(route)}`
      : `/${LOCALE}`;
  const request = new NextRequest(new URL(`${APP_ORIGIN}${path}`));
  if (visitor.acknowledged) {
    request.cookies.set(ACK_COOKIE_NAME, '1');
  }
  return request;
};

/**
 * Collapse a middleware response to a single readable outcome.
 *
 * Two vocabularies, because the two kinds of route answer in different currencies and
 * flattening them would hide the distinction this PR exists to establish:
 *
 * - **Pages** answer in redirects. The acknowledgement redirect carries a `?next=` absolute
 *   URL, which would make the snapshot churn on any origin change, so it is normalised to the
 *   gate that produced it rather than asserted verbatim.
 * - **Route handlers** answer in status codes. A redirect is not a legitimate outcome for one
 *   at all — `fetch` follows it transparently and the caller receives a 200 of HTML — so the
 *   status is what the row records, and a redirect appearing in an API row is itself the bug.
 */
const outcomeOf = (response: NextResponse, isApi: boolean): string => {
  const location = response.headers.get('location');

  if (location !== null) {
    if (location.startsWith(ENTRY_ORIGIN)) return 'redirect → entry (acknowledgement gate)';
    const { pathname } = new URL(location, APP_ORIGIN);
    if (pathname === `/${LOCALE}`) return 'redirect → /en (login)';
    if (pathname === `/${LOCALE}/home`) return 'redirect → /en/home';
    return `redirect → ${pathname}`;
  }

  if (!isApi) return 'render';

  if (response.status === 401) return '401 unauthenticated';
  if (response.status === 404) return '404 not_found';
  // The middleware passed it through; the handler is what answers next. The matrix stops here
  // deliberately — what the handler then does with ownership is its own test, not this one's.
  if (response.status === 200) return 'pass → handler';
  return `${response.status}`;
};

const gateFor = async (route: string, visitor: Visitor): Promise<string> => {
  session.current = visitor.role ? { role: visitor.role } : null;
  const response = await proxy(requestFor(route, visitor));
  return outcomeOf(response, route.startsWith('/api'));
};

const ROUTES = discoverRoutes();
const API_ROUTES = discoverApiRoutes();

// @trace flow=platform.auth category=security
describe('Studio middleware gate chain', () => {
  beforeEach(() => {
    session.current = null;
  });

  it('matches the committed route × visitor gate matrix', async () => {
    const header = `| Route | ${VISITORS.map((visitor) => visitor.label).join(' | ')} |`;
    const divider = `| --- | ${VISITORS.map(() => '---').join(' | ')} |`;

    const rowFor = async (route: string, label: string): Promise<string> => {
      const cells: string[] = [];
      for (const visitor of VISITORS) {
        cells.push(await gateFor(route, visitor));
      }
      return `| \`${label}\` | ${cells.join(' | ')} |`;
    };

    const rows: string[] = [];
    for (const route of ROUTES) {
      rows.push(await rowFor(route, `/${LOCALE}${route ? `/${route}` : ''}`));
    }
    // Handlers are listed by their on-disk pattern, not the concrete path the request used —
    // the pattern is what a reviewer recognises, and the substituted value is arbitrary.
    for (const route of API_ROUTES) {
      rows.push(await rowFor(route, route));
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

    // Handlers count too, and they fail differently: a page that slips the gate renders
    // something a human sees, while a handler quietly returns data to a script.
    for (const route of API_ROUTES) {
      if ((await gateFor(route, anonymous)) === 'pass → handler') {
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

  it('never answers a route handler with a redirect', async () => {
    // The property that makes the API branch worth having. `fetch` follows a 302 with no
    // ceremony, so a page-style bounce hands an XHR a 200 carrying the login page's HTML —
    // the caller sees success, parses garbage, and no status anywhere says "log in". Deleting
    // the `isApiPath` early return in `proxy.ts` makes every cell here a redirect, and no
    // other test in this app changes.
    const redirected: string[] = [];

    for (const route of API_ROUTES) {
      for (const visitor of VISITORS) {
        if ((await gateFor(route, visitor)).startsWith('redirect')) {
          redirected.push(`${route} (${visitor.label})`);
        }
      }
    }

    expect(
      redirected,
      `${redirected.join(', ')} answered a route handler with a redirect. Handlers must ` +
        'answer in status codes — a client cannot act on a redirect it has already followed.',
    ).toEqual([]);
  });

  it('refuses an unauthenticated or cross-app caller at every route handler with 401', async () => {
    const refused = ['anonymous', 'operator'];

    for (const route of API_ROUTES) {
      for (const label of refused) {
        const visitor = VISITORS.find((candidate) => candidate.label === label);
        if (!visitor) throw new Error(`${label} visitor missing from the matrix`);

        expect(await gateFor(route, visitor), `${route} admitted ${label}`).toBe(
          '401 unauthenticated',
        );
      }
    }
  });

  it('lets an artist through to the handler without requiring the acknowledgement', async () => {
    // Deliberate, and the one place the API chain differs from the page chain in what it
    // *checks* rather than how it answers. See the note on `gateApiRequest` in `proxy.ts`,
    // and issue #27, which moves the acknowledgement to the login page.
    const visitor = VISITORS.find((candidate) => candidate.label === 'artist, no ack');
    if (!visitor) throw new Error('the unacknowledged artist left the matrix');

    for (const route of API_ROUTES) {
      expect(await gateFor(route, visitor)).toBe('pass → handler');
    }
  });
});
