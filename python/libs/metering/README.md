# artloupe-metering

What a run spent, and the ceilings that stop it spending more.

Per node: tokens, latency, and cost. Per run: the NFR-04 plan budget with a hard stop, plus
recursion, per-node visit, and wall-clock caps. Every row carries the one `run_id` that also
identifies the run in studio and in operations (NFR-09).

```python
from artloupe.metering import record_usage

async def analyse(state):
    response = await client.messages.create(...)
    record_usage(
        model=response.model,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )
    return {"findings": ...}
```

Running a graph under the guards is `artloupe.agent.runtime.execute_run` — this package
counts runs, not topologies, and depends on no graph library.

## Why it exists before any provider does

Nothing in this repository calls a model yet. That is the reason to build it now rather than
a reason to wait: a cost ledger added after the first paid call is retroactively blank, and
the operations cost panel (FR-905) renders an empty table for every run that came before it.

## Modes

| `ARTLOUPE_METERING` | Sink | Use |
| --- | --- | --- |
| `memory` (default) | `InMemoryMetricsSink` | Unit tests and CI. Correct, and invisible to operations. |
| `postgres` | `PostgresMetricsSink` | Anything whose cost someone will look at later. |

The default is `memory` so no unit test needs a database. Nothing silently upgrades itself.

## Four decisions worth not re-deriving

- **The table is in `public` with RLS and no policy** — the opposite of the checkpoint
  tables, on purpose. Checkpoints are hidden in an unexposed schema because nothing outside
  the graph reads them; this table's only consumer is the operations dashboard, which reads
  through PostgREST, so hiding it would hide it from the one thing that needs it. RLS with no
  policy denies `anon` and `authenticated` outright, and `service_role` bypasses RLS.
- **Guards are enforced at the node boundary**, not inside node bodies and not only around
  the run. Refusing to *start* a node means no partial work and no half-charged ledger;
  cancelling mid-node would leave a checkpoint with a node half-applied. The run-level
  `asyncio.timeout` is a backstop for a node that hangs and never reaches a boundary.
- **A node reports its own usage through a `ContextVar`**, so node signatures do not change
  and nothing non-serializable enters LangGraph's config — the checkpoint is the one object
  here that must stay boringly serializable. Outside an instrumented run `record_usage` is a
  no-op, so a node stays callable directly in a unit test.
- **Unpriced is not free.** `cost_usd` is `None` when the model is not in the price table and
  `0` when the node spent no tokens. A model can ship before the table is updated, and a run
  must not fail over its own accounting — but an operations panel that renders those two the
  same is reporting a number it does not have.

## The resume hazard this package cannot fix

On resume, LangGraph re-runs the **whole node** containing `interrupt()` from the top. Any
metering before the `interrupt()` call is charged twice. `NodeMetric.attempt` makes the
second charge visible rather than preventing it; the fix is structural, and it is to keep
`interrupt()` alone in a node that does nothing else.
