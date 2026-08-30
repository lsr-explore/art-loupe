# 0002 — Supabase is the identity authority; Python verifies but never authenticates

- **Status:** Accepted
- **Date:** 2026-08-20
- **Deciders:** Laurie Reynolds

## Context

Art Loupe runs three Next.js surfaces and a Python agent layer over a Supabase Postgres
database. Four questions had to be answered together, because answering any one of them
alone constrains the others:

1. Where do the frontends and the Python services deploy?
2. Which component is the authority on who a user is?
3. Where does the session live, and who decides when it expires?
4. What connects to Supabase, and under whose authority?

Before this decision the repository had a working `AuthProvider` seam in `packages/auth`,
a Supabase email/password provider for `apps/studio`, and a shared env-credential
`demoAuthProvider` for `apps/operations`. Neither carried a token: `provider-supabase.ts`
validated the password and discarded Supabase's session, persisting only
`{ username, role }`. That was sufficient while nothing downstream needed to prove who the
caller was. It stops being sufficient the moment a Python service reads artist data.

An initial design had the Python service authenticate — the Next.js apps would post
credentials to FastAPI, which would call Supabase and return a session. It was rejected on
security grounds during this review; the reasoning is recorded under Alternatives.

## Decision

**Identity.** Supabase Auth is the sole identity authority. The Next.js server functions
authenticate against it directly. **Python never handles a credential** and has no
password code path at all.

**Token issuance.** Nothing in Art Loupe mints a token. Supabase signs; everything else
verifies. This is a hard constraint, not a default.

**Session.** The session of record is Art Loupe's own iron-session cookie — encrypted,
`httpOnly`, host-only — now carrying Supabase's access and refresh tokens alongside the
principal. **The browser never holds a token**, only an opaque cookie. Expiry is sealed
inside the encrypted payload, so the server decides it and a client cannot extend it.

**Session lifetime is set explicitly**: 8 hours by default, overridable per app through
`AUTH_SESSION_TTL`, with `apps/operations` set to 1 hour. Previously this was
iron-session's 14-day default, inherited rather than chosen.

**Clock reconciliation.** The sealed cookie and the access token expire on different
schedules. `getAccessToken` refreshes proactively 60 seconds ahead of expiry, and **a
failed refresh destroys the session** rather than leaving a valid seal over a dead token.

**Data access.** Python receives the forwarded access token and uses it for Supabase
queries, so Postgres RLS resolves `auth.uid()` as the real user and enforces ownership
independently of application code. The service-role key is reserved for system-level work
(checkpoint writes, eval jobs) and must stay off the request-serving path.

**Roles.** `Role` (`artist` | `operator` | `superuser`) resolves from Supabase
`app_metadata.artloupe_role`, which is writable only with the service-role key.
`user_metadata` is user-writable and is never consulted. An unrecognised value resolves to
`artist`, the least-privileged role.

**Deployment.** `entry`, `studio`, and `operations` stay on Vercel as separate projects,
upholding the existing settled decision. Python services deploy to Cloud Run with no public
ingress, reached from Vercel via OIDC/Workload Identity Federation rather than a
service-account key.

## Rationale

The decisive question was blast radius. With Python verifying rather than authenticating,
it holds **no auth secret at all** — JWKS verification uses public keys. A fully compromised
Python service can serve data to a caller who already has a valid token, and that is the
ceiling. It cannot mint a token and it cannot harvest a password, because it never sees one.

Keeping Supabase as the only signer is what preserves RLS as a real second line of defense.
A token Art Loupe minted would not satisfy `auth.uid()`, forcing Python to assert claims
itself — application-layer authorization wearing RLS's clothing, with the database no longer
independently enforcing anything.

The remaining argument for routing login through Python was a centralized audit point.
Supabase Auth already logs auth events, and the audit that matters for this product — who
read or wrote whose work — belongs at the data layer, which Python owns either way.

Not minting tokens also declines a large amount of dangerous work: password hashing, login
rate limiting, lockout, reset flows, refresh-token rotation, and MFA are all already
implemented upstream and are all easy to get subtly wrong.

## Alternatives

- **Python relays credentials to Supabase and returns Supabase's tokens.** Sound, and
  briefly chosen during this session. Rejected because it puts plaintext passwords through
  a third component that must then never log a request body, buffer one, or include one in
  an error trace — a class of mistake that simply does not exist when the hop is absent. Its
  one real benefit, a single audit chokepoint, is obtainable more cheaply.
- **Python mints its own tokens.** Rejected. It transfers signing, key rotation, revocation,
  and replay protection to us, and it breaks RLS as described above.
- **Python owns the session; Next.js proxies every request.** Rejected. The route guard runs
  on every navigation, so this adds a cross-cloud round trip to every page load, and in
  practice forces the frontends off Vercel to keep latency tolerable. It buys no security
  over the chosen design.
- **Python connects with the service-role key and enforces ownership in application code.**
  Rejected as the default. Simpler queries, but one bug becomes an unguarded data leak and
  the database stops being a check on the application. Retained only for system-level work.
- **Moving `apps/operations` to Cloud Run for internal ingress.** Considered and dropped —
  it contradicts a settled decision, and the exposure it addresses is better closed by
  replacing the shared credential with real accounts and MFA.

## Consequences

- `AuthProvider.authenticate` now returns `AuthResult` (`{ user, tokens? }`) rather than
  `Session | null`. The seam absorbed the change; `demoAuthProvider` returns no tokens and
  behaves as before.
- **A demo session cannot reach the Python services.** It carries no Supabase-signed token,
  and verification is the only way in. This now bites only the hermetic e2e run, since both
  apps authenticate against Supabase in every other environment.
- **Per-surface audience separation is unavailable.** Supabase issues `aud: "authenticated"`
  for every signed-in user, and a relayed token cannot carry a custom audience. Separating
  studio from operations is therefore role-based, or needs a Supabase custom access token
  hook. An earlier plan to use the `aud` claim for this does not work.
- Verification lives in `python/libs/auth` as a shared library, not a service. Under this
  design it is a function every service calls in-process, so a network hop of its own would
  buy nothing.
- Local development needs `SUPABASE_JWT_SECRET`, because a local `supabase start` still
  issues legacy HS256 tokens. That mode gives every verifier material that can also sign;
  it is a local-only concession, and hosted projects should use JWT signing keys.
- **A `NODE_ENV === 'test'` guard on the `AUTH_PROVIDER=demo` branch does not work, and was
  reverted.** Next inlines `process.env.NODE_ENV` at build time, so in a production build
  the comparison is folded away entirely — the compiled output became an unconditional
  `throw`, and every auth e2e test broke, in both apps. The e2e harness deliberately builds
  with `NODE_ENV=production` and serves with `NODE_ENV=test`, and serve-time `NODE_ENV`
  cannot gate build-time-inlined code. `AUTH_PROVIDER` defaulting to `supabase` remains the
  control; the real fix is deleting the branch, below.
- `demoAuthProvider` now compares in constant time. It was using `===`, which short-circuits
  at the first differing byte.

## Open follow-ups

- ~~**Replace the shared operations credential**~~ — **done.** `apps/operations` now uses
  `createSupabaseAuthProvider` and restricts sign-in to `operator` / `superuser` via
  `signIn`'s `allowRoles`; `scripts/seed/seed-demo-accounts.sh` seeds the role into
  `app_metadata`. `demoAuthProvider` survives for hermetic e2e only and is refused outside
  `NODE_ENV=test`. **Still outstanding: TOTP MFA on that surface**, and per-person accounts
  rather than one seeded demo operator.
- **Delete the studio demo bypass** by running local Supabase in the Playwright CI job with
  a seeded test user. MSW is not an alternative here: the Supabase call happens server-side
  inside a Server Action, which neither `page.route` nor MSW's browser worker intercepts.
- **Write the RLS policies.** Nothing in this decision is load-bearing until the tables
  exist and carry policies reading
  `auth.jwt() -> 'app_metadata' ->> 'artloupe_role'`.
- **Wire per-app role enforcement** in the middleware guard. `Role` is resolved and stored
  but nothing branches on it yet.
- **Set up Vercel OIDC → GCP Workload Identity Federation** before the first Cloud Run
  service ships.
- **Tighten the Supabase auth policy**: `minimum_password_length = 6`, no
  `password_requirements`, `enable_confirmations = false`, and `secure_password_change =
  false` are the current local values. The last is an escalation path — a stolen session can
  become a permanent account takeover without reauthentication.

## Related

- `docs/decision-records/settled-decisions.md`
- `packages/auth/README.md`
- `python/libs/auth/` — the verification library and its FastAPI guards
