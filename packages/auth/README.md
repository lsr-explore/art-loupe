# @artloupe/auth

Art Loupe's shared server-side authentication — a single, security-sensitive place
the three apps depend on for sessions, rather than three copies to keep correct.

Supabase Auth is the identity authority; nothing here mints a token. Two providers sit
behind one `AuthProvider` seam, both persisting to the same encrypted
[iron-session](https://github.com/vvo/iron-session) cookie:

- **`createSupabaseAuthProvider`** — Supabase Auth email/password. Used by both
  `apps/studio` (artists) and `apps/operations` (operators).
- **`demoAuthProvider`** — one shared credential read from the environment. Hermetic
  e2e runs only; both apps refuse it outside `NODE_ENV=test`.

Swapping providers changes the credential check only; the login flow, the session
shape, and the route guard are untouched.

## Entry points

| Import | Runtime | Use for |
| --- | --- | --- |
| `@artloupe/auth` | any | Types, `demoAuthProvider`, `getSessionOptions` |
| `@artloupe/auth/server` | Node (RSC / Server Action / Route Handler) | `getSession`, `signIn`, `signOut` |
| `@artloupe/auth/middleware` | Edge Middleware | `getSessionFromRequest` |

`/server` and `/middleware` are split because they read the cookie differently:
server code uses the `next/headers` cookie store; middleware is handed a
request/response pair.

## The `AuthProvider` seam

```ts
interface AuthProvider {
  authenticate(credentials: Credentials): Promise<AuthResult | null>;
}

interface AuthResult {
  user: Session;
  tokens?: Tokens; // Supabase's own; absent for the demo provider
}
```

`signIn(credentials, provider)` validates through the provider and, on success,
persists the principal *and any tokens* into the sealed cookie. It defaults to
`demoAuthProvider`; the studio passes a Supabase-backed implementation of the same
interface.

`demoAuthProvider` issues no tokens, so a demo session cannot reach the Python
services — they accept only Supabase-signed tokens. See ADR 0002.

## Tokens and the backend

Supabase's access and refresh tokens live inside the encrypted cookie and **never reach
the browser**, which only ever holds an opaque value. `@artloupe/auth/server` exposes:

| Helper | Purpose |
| --- | --- |
| `getAccessToken(refresher?)` | A usable access token, refreshing 60s ahead of expiry |
| `fetchWithSession(url, init, refresher?)` | Calls a backend as the signed-in user |

Both may write or clear the cookie, so they need a **mutable cookie context** — a Server
Action or Route Handler, not a Server Component.

When a token cannot be renewed the session is **destroyed**, not left in place. A live seal
over a dead token means the route guard reports a signed-in user while every data call
fails — a broken app instead of a login form.

## Roles

`Session.role` resolves from Supabase `app_metadata.artloupe_role`, which is writable only
with the service-role key. `user_metadata` is user-writable and is deliberately never read.
An unrecognised value resolves to `artist`, the least-privileged role.

Surfaces restrict who may sign in by passing `allowRoles` to `signIn`:

```ts
await signIn(credentials, provider, { allowRoles: ['operator', 'superuser'] });
```

Checked **before** the session is written, so a refused principal never holds a valid
cookie — the difference between "you may not view this page" and "you may not sign in
here". A refused role is reported identically to a wrong password, so the operations
login does not confirm that an artist's account exists.

`apps/operations` uses this today. Route-level branching on `role` after sign-in is not
wired up yet; sign-in is currently where the boundary lives.

## Required environment

| Var | Purpose |
| --- | --- |
| `AUTH_SESSION_PASSWORD` | iron-session encryption key — **≥ 32 chars** |
| `AUTH_SESSION_TTL` | Session lifetime in seconds. Optional; defaults to 8 hours. Rejects `0`, which iron-session reads as "never expires". |
| `DEMO_AUTH_USERNAME` | Demo super-user username |
| `DEMO_AUTH_PASSWORD` | Demo super-user password |

These are validated at **runtime**, not in each app's `env.ts`, so a CI `next build`
needs no secrets; consuming apps document them in `.env.example`.

One optional opt-out:

| Var | Purpose |
| --- | --- |
| `DISABLE_HTTPS_UPGRADE` | Set `true` when serving the production build over plain **HTTP** (local `next start`, Playwright e2e). Drops the session cookie's `Secure` flag — which strict engines like WebKit otherwise refuse to send over HTTP. The apps gate their HSTS / `upgrade-insecure-requests` headers on the same flag. Leave unset for real HTTPS deploys. |

## Consumer setup

```jsonc
// package.json
"dependencies": { "@artloupe/auth": "workspace:*" }
```

```ts
// next.config.ts
transpilePackages: ['@artloupe/fascia', '@artloupe/auth'],
```
