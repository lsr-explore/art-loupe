# artloupe-agent

LangGraph orchestration behind FastAPI — the one HTTP surface the Python side exposes.

Per [ADR 0002](../../../docs/decision-records/0002-authentication-authority-and-deployment-topology.md)
the call path is **browser → Next.js route handler → this service**. The browser never
reaches it directly, and Python never handles a credential: it verifies a Supabase access
token the apps forwarded, through `artloupe-auth`.

## Currently a skeleton

One graph node, one authenticated endpoint, one health check. It exists so the transport, the
auth guard, and a compiled graph are proven together **before** any of them carries real work
— the failure this avoids is debugging a transport or lifecycle problem at the same time as
the Studio Director's routing.

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness. A probe has no token to present, and a health check that fails on auth reports the wrong thing when auth is what broke. Returns no state and no build detail — an unauthenticated endpoint should not be a reconnaissance surface. |
| `POST /runs` | bearer | Runs the graph and returns the result. `owner` comes from the **verified token**, never the request body. |

## Run it

```sh
uv run --directory python python -m artloupe.agent.service   # 127.0.0.1:8080
uv run --directory python poe test                           # the suite
```

Binds loopback deliberately. Nothing here should be reachable off the machine in local
development, and the deployed binding is a decision that does not exist yet.

## Shapes that will not change

- **`build_graph(checkpointer=None)`** takes its checkpointer by injection. PR 3 supplies a
  process-wide `AsyncPostgresSaver`; a graph that built its own would open a connection pool
  per call. The sibling repo `veloce-trace` settled on this signature for the same reason.
- **Nodes return partial state.** `RunState.node_trail` accumulates through its reducer, so a
  node returning whole state would overwrite the history the reducer exists to build.
- **`owner` is the verified token's subject** — the value Postgres RLS reads as `auth.uid()`.
  Sourcing it anywhere else is an authorization bypass, not a cosmetic bug, and there is a
  test pinning exactly that.

## Deliberately absent

- **No Dockerfile.** Nothing is deployed, so container packaging is deferred with the
  deployment decision rather than guessed at.
- **No resource caps.** `recursion_limit`, a wall-clock deadline, and the budget ledger's
  hard stop land in PR 4. A single-node graph cannot loop, so there is nothing to bound yet —
  but nothing here should grow a second edge before they exist.
- **No `artloupe-schemas` dependency.** The skeleton has no contract to carry; it arrives
  with intake in PR 7.
