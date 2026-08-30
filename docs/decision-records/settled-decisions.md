# Settled decisions — do not relitigate

Standing constraints the build runs on. These are **decided**; revisit only with a
concrete new reason, and when one is genuinely reopened, capture the change here (or
graduate it to an ADR). Architectural commitments live in
[`docs/decision-records/`](./); this is the lighter-weight running ledger of settled
product + platform calls.

## Product direction

- **Art Loupe is the Artist's Studio Director** — critique, palette and value studies,
  and studio session planning for working artists.
- **The system never generates imagery.** It analyses work the artist supplies and
  returns text, deterministic colour/edge analysis, and citations. This is the
  authorship and copyright commitment the design rests on, not a temporary scope limit.
- **Content sourcing is open-access only** — public-domain and open-access museum
  programs (The Met, Smithsonian, Art Institute of Chicago, Europeana), each under its
  own published terms. Commercial pricing sites are **not** scraped; pricing logic is
  deterministic and coded.

## Repository

- **Scaffolded from prior monorepo infrastructure**, not generated fresh — see
  ADR 0001. The reference copy lives outside the repo.
- **Package scope `@artloupe/*`**; root package `art-loupe`. Python namespace
  `artloupe.*` mirrors it.
- **Worktree root** is `capstone/art-loupe/worktrees`, placed by the `wt` helper at
  `<base>/<branch>/<repo>`.

## Frontend / apps

- **Three surfaces**: `entry` (apex, never authenticated), `studio`, `operations`.
  Deployed as separate Vercel projects.
- **The acknowledgement gate runs before the auth gate**, in every app proxy. The two
  are deliberately opposite in scope: the session cookie is host-only so a session
  cannot be replayed across surfaces; the acknowledgement cookie is domain-scoped so
  the notice is accepted once. Never widen the first or narrow the second.
- **Auth** — server-only `@artloupe/auth` owns it, behind an `AuthProvider` seam.
  **Both** studio and operations use Supabase email/password; the shared env credential
  survives only for hermetic e2e, refused outside `NODE_ENV=test`. Auth env stays **out
  of `env.ts`** so CI `next build` needs no secrets (validated at runtime).
- **Operations is operator-only, enforced at sign-in** via `signIn`'s `allowRoles`, so a
  refused principal never receives a cookie. Roles are seeded into `app_metadata` by
  `scripts/seed/seed-demo-accounts.sh`.
- **Supabase Auth is the only identity authority, and nothing in Art Loupe mints a
  token** — see ADR 0002. Python never handles a credential; it verifies the forwarded
  access token and forwards it to Postgres so RLS enforces ownership. The service-role
  key stays off the request-serving path. Roles come from `app_metadata`, never
  `user_metadata`.
- **The browser never holds a token.** Access and refresh tokens live inside the encrypted
  iron-session cookie; the client sees an opaque value. Session lifetime is set explicitly
  (8h default, 1h for operations) — never left to iron-session's 14-day default.
- **a11y enforced** by `eslint-plugin-jsx-a11y` (ordered after `eslint-config-biome`;
  Biome's overlapping a11y group stays off).
- **Cross-browser** — e2e runs chromium + firefox + WebKit; real deploys keep HSTS /
  `upgrade-insecure-requests` / `Secure` cookies, with a `DISABLE_HTTPS_UPGRADE` opt-out
  for HTTP-localhost serving.
- **i18n** — en/es parity is enforced by `pnpm i18n:check`. Shared chrome strings live in
  `packages/fascia`; app catalogs hold only what is their own and win on any key they
  redefine.

## Data layer

- **Supabase, local-first** via the CLI (pinned pnpm devDep); a hosted project only when
  a public deploy needs one.
- **pgvector enabled from the start** — the retrieval corpus is the first real workload.

## Testing

- **Every test declares a flow and a category.** The catalog is
  `docs/test-traceability-reports/flows.json`; an unknown value is a hard error in CI.
- **`untagged-baseline.json` is a ratchet, not a target.** Raising a number is a
  deliberate, reviewable act.

## Git

- **SSH commit signing**, configured globally; the signing key's public half is
  registered on GitHub. (Key details are machine-local — never in a checked-in file.)
- **Squash-merge only** — rebase breaks SSH signatures.
