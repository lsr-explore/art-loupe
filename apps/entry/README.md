# @artloupe/entry

The **entry point** — the public front door at the apex domain, from which the three app
surfaces launch. Deployed to `artloupestudio.com` with studio and operations on
subdomains of it.

> **Scaffold only.** This app currently renders a holding page. The two launch panels, the
> synthetic-data acknowledgement checkbox, its session cookie and the gate middleware are
> not built yet, and neither are the shared header, footer and demo banner. It exists
> ahead of them so `<AppShell>` is designed against four surfaces rather than three — this
> is the one with no sidebar and no user chip.

## How it differs from the other three apps

- **Never authenticated.** No `@artloupe/auth` dependency, no session, no login route, and no
  `AUTH_SESSION_PASSWORD` / `DEMO_AUTH_*` in `.env`. `src/proxy.ts` is locale negotiation only.
- **It will *set* the acknowledgement cookie rather than check one** (not built yet).
  The gate is middleware in the *other* three apps redirecting here when the cookie is
  absent. Gating this app on its own cookie would lock the door from the inside.
- **No agent dependency.** Nothing here talks to the reasoning service.

## Run

```sh
pnpm install
pnpm dev:entry          # http://localhost:3003
```

Or from this directory: `pnpm dev`. No `.env.local` is required.

## Quality

Run everything: `pnpm check:all` from the monorepo root.

Per-app: `pnpm test`, `pnpm e2e`, `pnpm typecheck`, `pnpm size`.

## Notes

- **Token values are provisional.** `globals.css` starts from the studio palette; the per-app
  anchor shift and AA re-verification are still to come. fascia owns the token
  *contract*, each app supplies the *values*.
- Exercising the cross-subdomain acknowledgement cookie locally needs `*.localhost` or a hosts
  entry; DNS is wired at deploy.
