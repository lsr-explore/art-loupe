# @artloupe/studio

The artist-facing **critique and studio companion** — structured formal analysis of work
the artist supplies, alignment critique against their stated goal, palette and value
studies, and session planning. Every art-historical claim carries a citation.

**The system never generates imagery.** It reasons about work the artist made.

> Currently a scaffold: the shell, the acknowledgement gate, sign-in, and a placeholder
> home. The critique workflows build out from here.

## Run

This app is **login-gated** by [`@artloupe/auth`](../../packages/auth/README.md), using
Supabase email/password. Set the environment first — the proxy needs it or every request
500s:

```sh
cp .env.example .env.local
# then edit: AUTH_SESSION_PASSWORD (≥32 chars) + SUPABASE_URL / SUPABASE_ANON_KEY
```

From the monorepo root:

```sh
pnpm supabase start                      # Supabase Auth must be running
./scripts/seed/seed-demo-accounts.sh     # pre-confirmed demo artist + operator
pnpm dev:studio                          # http://localhost:3001
```

Or from this directory: `pnpm dev`.

Reach this app through the entry point at <http://localhost:3003> — the acknowledgement
gate runs before the auth gate, so visiting port 3001 directly bounces you there first.

To run without Docker, set `AUTH_PROVIDER=demo` in `.env.local` and sign in with the
`DEMO_AUTH_*` credentials instead.

## Quality

Run everything: `pnpm check:all` from the monorepo root.

Per-app: `pnpm test`, `pnpm e2e`, `pnpm typecheck`, `pnpm size`.
