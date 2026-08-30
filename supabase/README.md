# Supabase — local data layer

Local-first Postgres + pgvector + Auth + Studio, run entirely in Docker via the
Supabase CLI. **No cloud project** — a hosted project is added only when a public
deploy needs one (`supabase db push`).

Two things depend on this stack today: **Supabase Auth**, which backs sign-in for
`apps/studio`, and **pgvector**, which will back the art-historical retrieval corpus.

## Prerequisites

- Docker Desktop running.
- Supabase CLI — pinned as a repo dev dependency; invoke as `pnpm supabase …`.

## Start / stop

```sh
pnpm supabase start     # first run pulls several GB of images
pnpm supabase stop      # stops containers; add --no-backup to also drop local data
pnpm supabase status    # prints the URLs + keys below
```

Migrations in `migrations/` apply automatically on `start`. To re-apply from scratch
(drops local data, replays every migration):

```sh
pnpm supabase db reset
```

## Connection env (local defaults)

Ports are fixed in [`config.toml`](./config.toml). This CLI issues the **new API-key
format** — a `Publishable` key (browser-safe; replaces the legacy `anon` key) and a
`Secret` key (replaces `service_role`). Both are shared local-dev defaults, never
reused in any deployed env. Run `pnpm supabase status` to print the live set.

| What | Value |
|---|---|
| API URL | `http://127.0.0.1:54321` |
| Studio | `http://127.0.0.1:54323` |
| Mailpit (email catcher) | `http://127.0.0.1:54324` |
| Postgres (direct) | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Publishable key | `sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH` |
| Secret key | _not committed — read from `pnpm supabase status`_ |

> **Key boundary.** The **Secret** key bypasses Row Level Security and must live
> **only** on the service boundary, never on a browser-reachable surface — so it stays
> out of this committed file. Application tables enable RLS with no policies, so
> anon/authenticated access is denied by default; only the service boundary reads or
> writes. The anon/publishable key is what the studio app uses for Auth, and is safe
> to commit.

## Schema

- `extensions.vector` — pgvector extension enabled.

No application tables ship yet — the only migration enables the `vector` extension.
Schema for the retrieval corpus lands with the ingestion pipeline.
