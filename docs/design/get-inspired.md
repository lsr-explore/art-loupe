# Get Inspired: frontend system design practice

The Studio route is `/[locale]/get-inspired`. Home contains a link; no Studio redesign
is required. This phase displays images and available creator, medium, and date metadata.
It does not start projects, open an insights view, or generate imagery.

## Trace one search

```text
Keystroke → draft → 350 ms debounce → validated request → React Query key
  → GET /api/inspiration → authenticated Next.js bridge
  → POST /inspiration/search → shared Supabase Postgres cache
  → Pexels search OR Met search + bounded object-detail requests
  → normalized result → query cache → derived filter/sort → responsive figures
```

Image bytes load directly from the two approved image hosts. Provider APIs are reached
only by Python. Browser `connect-src` remains `self`; API keys and user access tokens
never enter the browser. CSP allows images from `images.pexels.com` and
`images.metmuseum.org`, with no arbitrary image proxy.

## Pieces to remember

| Piece | Code | Why it exists |
| --- | --- | --- |
| Draft versus committed input | `use-search-input.ts` | Typing is immediate; requests wait 350 ms. Submit commits immediately. Source changes clear incompatible filters and commit immediately. |
| Timer cleanup | `use-search-input.ts` | Every keystroke cancels the previous timer; unmount cancels the final one. |
| Validation and normalization | `packages/schemas/src/inspiration.ts` | Trim whitespace, bound inputs and pages, reject filters for the wrong provider, require ordered date pairs. Python validates again at its own boundary. |
| Query key | `inspiration-search.tsx` | Source and request filters identify server data. The same normalized search reuses its cache. |
| Cancellation | `search.ts` | React Query supplies an AbortSignal. Obsolete fetches are cancelled and cannot overwrite a newer query. |
| Infinite query | `inspiration-search.tsx` | Explicit Load more keeps pagination under user control. A changed query starts at page one. A failed next page retains prior pages. |
| Server versus view state | `results.ts` | Query pages are server state; title/creator filtering and sorting are derived view state. Local controls do not make requests. |
| Immutable sorting | `results.ts` | `toSorted` leaves cached arrays intact; unknown dates sort last in either direction. Duplicate IDs across pages are removed. |
| Two cache layers | Page QueryClient and `inspiration_cache.py` | Browser cache improves revisits; shared database cache avoids repeated provider calls across Cloud Run instances. |
| Layout | fascia `ImageMetadataCard` | Fixed image space limits layout shift; `object-contain` preserves the whole painting. Metadata survives a broken image. |
| Accessibility | fascia primitives and Playwright | Native selects, associated labels, visible focus, 44px controls, polite status, semantic figures, and error announcements. |

Start with this recall exercise: name each state variable, classify it as draft input,
server state, or derived view state, then explain which changes cause a network request.
Next explain what happens when the user types "tree", changes it to "flowers", and the
first response arrives last. Finally explain an outage with and without a cached result.

## Provider semantics

Pexels provides orientation, minimum size, and color filters. Its documented photo search
has no include/exclude-people parameter and no sorting parameter, so neither is invented.
Pexels provides photographer and description metadata, not painting medium or creation date.
Provider attribution and photographer/photo links are displayed now as requested by its
API guidelines; future image-click navigation remains deferred.

Met requests `medium=Paintings` and `hasImages=true` using paginated `/v1.1/search`.
Each detail record must additionally be classified as Paintings, be public domain, and
have an HTTPS image URL on the approved Met image host. A later broken image is handled
in the card; a nonempty URL cannot guarantee a host will remain available.

With only an artist, Met's artist-or-culture search narrows candidates; returned artist
names must also contain the requested name, case-insensitively. With keywords and an
artist, keyword search selects candidates and the artist check narrows each batch.
The field is a substring match, not an authoritative artist identifier. Department is
not exposed. Date ranges and highlights are provider request filters.

Both sources request 24 candidates per page. Met batches can contain fewer displayable
paintings, even zero, after eligibility/artist checks. Load more continues where available;
there is no misleading total claiming all provider candidates are displayable paintings.
Met limits search to its first 10,000 candidates. Sorting/filtering explicitly applies
only to loaded images, not the entire upstream collection.

## Failure and cache behavior

Search results are fresh for 24 hours and may be served stale for seven days when a
provider is unavailable. Cache keys include every validated request field and a contract
version. Old keys are pruned on writes. Partial Met batches are not cached, so transient
detail failures do not become a fresh cache entry. Successful empty searches are cached.

The browser cache is fresh for five minutes and retained for thirty minutes after it
becomes inactive. It is scoped to the mounted page, with no localStorage persistence or
server-module singleton. Focus does not automatically spend provider quota.

Timeouts bound requests: provider calls use five seconds each, a provider search has
an eighteen-second overall deadline, cache operations have three seconds, and the bridge
has thirty seconds. Met detail concurrency is four per search; backend search and database
concurrency are each capped at four per process. These are process limits, not distributed
rate-limit enforcement. Cache misses may race across instances; provision Cloud Run
maximum instances and quotas for the provider account before increasing traffic.

Missing configuration, malformed provider responses, network failures, rate limits,
expired sessions, empty results, partial metadata, and broken images have distinct behavior.
A provider outage uses stale data if available. An unavailable cache degrades to a provider
request. No upstream error bodies, credentials, DSNs, or queries are logged by this feature.
The frontend offers retry, preserves already loaded pages after pagination failure, and
shows partial/stale notices. An expired session asks the artist to sign in again.

## Verify it

Use Node 24 (the repository's current test tools require a modern Node runtime).
The installed Vite/Rolldown pair currently fails while bundling Vitest config; the
`--configLoader runner` option avoids that dependency issue without changing the feature.

```sh
pnpm --filter @artloupe/studio exec vitest run --configLoader runner src/components/inspiration src/lib/inspiration src/app/api/inspiration
pnpm --filter @artloupe/fascia exec vitest run --configLoader runner src/components/blocks/image-metadata-card.test.tsx
pnpm --filter @artloupe/schemas exec vitest run --configLoader runner src/inspiration.test.ts
uv run --directory python pytest services/agent/tests/test_inspiration.py services/agent/tests/test_service.py
pnpm --filter @artloupe/studio typecheck
PLAYWRIGHT_PORT=3101 pnpm --filter @artloupe/studio exec playwright test e2e/inspiration.spec.ts
```

An explicit `PLAYWRIGHT_PORT` starts an isolated test server instead of reusing a running
development server. Playwright stubs the same-origin API and image requests, never calls the live providers,
and tests the production UI with the existing demo-auth harness. Backend and bridge unit
tests cover the boundaries hidden by those browser stubs. The shared parity fixture is
loaded by both TypeScript and Python tests.

Axe audits use WCAG 2 A/AA, 2.1 AA and 2.2 AA tags. Keyboard traversal, result filtering,
error recovery and 320px reflow are asserted separately. Automated axe checks alone cannot
certify every WCAG criterion; review screen-reader announcements and focus behavior when
changing interaction design.

## Sources

- [Pexels API documentation](https://www.pexels.com/api/documentation/)
- [Met Collection API documentation](https://metmuseum.github.io/)
- [Vercel to Google Cloud federation](https://vercel.com/docs/oidc/gcp)
- [Google STS token exchange](https://cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token)
- [Cloud Run service authentication](https://cloud.google.com/run/docs/authenticating/service-to-service)
