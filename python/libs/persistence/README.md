# artloupe-persistence

LangGraph checkpointing — the library that makes an interrupted run resumable.

When a geometry tool's confidence falls below threshold the graph stops and waits for the
artist (FR-402). The checkpoint written here is what lets the run continue afterwards:
minutes later, and **in a different process** than the one that paused it.

```python
from artloupe.persistence import get_async_checkpointer

checkpointer = await get_async_checkpointer()
graph = build_graph(checkpointer=checkpointer)
```

## Why this is its own package

The cross-process requirement is the whole reason. An in-memory saver makes a resume *look*
like it works — the same process still holds the state — so a test built on one proves
nothing about durability and gives exactly the false confidence this package exists to remove.
`libs/persistence/tests/test_interrupt_resume.py` runs the graph in two genuinely separate
`python` processes for that reason.

## Modes

| `ARTLOUPE_PERSISTENCE` | Saver | Use |
| --- | --- | --- |
| `memory` (default) | `InMemorySaver` | Unit tests and CI. Correct only where a restart cannot happen. |
| `postgres` | `AsyncPostgresSaver` | Anything with a real interrupt. |

The default is `memory` so no unit test needs a database. Nothing silently upgrades itself.

## Three decisions worth not re-deriving

- **Tables live in `langgraph`, never `public`.** `supabase/config.toml` exposes
  `["public", "graphql_public"]` through PostgREST, so an unprotected table in `public` is
  readable by anyone holding the anon key — a published value. `AsyncPostgresSaver` has **no
  schema parameter**, so isolation comes from `options=-csearch_path=langgraph,public` on the
  connection, and there are tests pinning both the connection string and the live table
  placement.
- **One pool per process, built behind a lock.** The saver takes a connection; a graph that
  built its own would open a pool per call. Double-checked locking, because two coroutines can
  both pass the outer nil check before either acquires.
- **`autocommit=True` and `prepare_threshold=None` are correctness, not style.** `.setup()`
  issues DDL that must not sit in an open transaction, and pooled connections reject prepared
  statements. A tidy-up that drops either produces an intermittent startup failure.

## Running the durability test

```sh
pnpm supabase start
uv run --directory python poe test
```

Without a reachable Postgres the interrupt/resume tests **skip** with a message. In CI they
must not: the workflow sets `ARTLOUPE_REQUIRE_POSTGRES=1`, which turns an unreachable database
into a failure. Otherwise a broken service container would be indistinguishable from a green
run, on the one test that proves the mechanism.

## The hazard this package encodes

On resume, LangGraph re-runs the **entire node** containing `interrupt()` from the top.
Anything that node did beforehand — a storage write, a metering increment, a model call —
happens twice.

So `interrupt()` gets a node to itself that does nothing else. The spike graph is shaped
`propose → await_correction → apply` precisely to demonstrate this, and
`test_resume_does_not_re_run_the_node_before_the_interrupt` asserts `propose`'s side effect
fires exactly once across a restart. When that side effect becomes a real metering increment,
this is what stops the budget ledger (NFR-04) double-charging every corrected run.
