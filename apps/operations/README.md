# @artloupe/operations

The operational dashboard — the single pane of glass for the studio's agent activity,
evaluation health, guardrails, and cost. Planned panels: activity feed, eval health,
prompt version management, cost & latency per agent.

> Currently a scaffold: the shell, the acknowledgement gate, sign-in, and a placeholder
> home. `/` is the public landing; the panels live at the post-login home.

## Run

This app is **login-gated** by [`@artloupe/auth`](../../packages/auth/README.md), using
Supabase operator email/password. Only accounts carrying
`app_metadata.artloupe_role` of `operator` or `superuser` may sign in — an artist
account with valid credentials is refused at login and never receives a session.

```sh
cp .env.example .env.local
# then edit: AUTH_SESSION_PASSWORD (≥32 chars) + SUPABASE_URL / SUPABASE_ANON_KEY
```

From the monorepo root, with the local Supabase stack running:

```sh
pnpm install
pnpm supabase start
./scripts/seed/seed-demo-accounts.sh     # pre-confirmed demo artist + operator
pnpm dev:operations                      # http://localhost:3000
```

Or from this directory: `pnpm dev`.

Open `/`, accept the synthetic-data consent, and sign in as
`demo.operator@demo.artloupestudio.com` to reach the operations panels.

The `DEMO_AUTH_*` shared credential remains only for the hermetic e2e run
(`AUTH_PROVIDER=demo`), and the login action refuses it outside `NODE_ENV=test`.

## Quality

Run everything: `pnpm check:all` from the monorepo root.

Per-app: `pnpm test`, `pnpm e2e`, `pnpm typecheck`, `pnpm size`.
