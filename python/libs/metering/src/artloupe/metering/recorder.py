"""The thing that measures a node and the thing that stops the run.

One object owns both, because a ceiling is only enforceable by whatever is counting. Splitting
them would mean two sources of truth for how many tokens a run has spent, and the interesting
failure — a hard stop that does not fire — is exactly the one that split would cause.

## How a node reports what it spent

No provider is wired into this repository yet, so there is no callback to read usage from.
Rather than guess at one, a node reports its own usage by calling the module-level
`record_usage(...)`, which finds the node currently executing through a `ContextVar`:

    async def analyse(state):
        response = await client.messages.create(...)
        record_usage(
            model=response.model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )
        return {...}

Three properties this shape has, and a `config`-passed recorder does not:

- **Node signatures do not change.** A deterministic node stays `(state) -> dict` and records
  a real zero, which is correct — it spent no tokens.
- **Nothing non-serializable enters LangGraph's config.** A recorder placed in
  `config["configurable"]` travels with the graph into the checkpointer, and the checkpoint is
  the one object in this system that must stay boringly serializable.
- **It is where a provider callback will plug in.** When one exists it calls `record_usage`
  from inside the node's own context and every node stops needing to.

`record_usage` outside an instrumented node is a **no-op**, not an error. A node has to remain
callable directly in a unit test, and a test that fails because it forgot to build a recorder
would teach people to stop instrumenting.

## Where the guards are enforced

At the node boundary, in `RunRecorder.node()` — not inside node bodies and not only around the
whole run:

- **Before a node runs:** already stopped, past the deadline, or over the per-node visit cap.
  Stopping *before* a node means no partial work and no half-charged ledger.
- **After a node returns:** the token ceiling, because the tokens it just spent are what may
  have crossed it.

The wall clock is checked at the boundary rather than enforced by cancellation for the same
reason. Cancelling mid-node leaves a checkpoint with a node half-applied; failing cleanly at
the next boundary leaves one that can be reasoned about. `artloupe.agent.runtime` still wraps
the whole run in a hard timeout, because a single node that hangs forever never reaches a
boundary — that is a backstop, not the mechanism.
"""

import inspect
from collections import Counter
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from decimal import Decimal
from time import monotonic
from typing import Any

from artloupe.metering.guards import (
    BudgetExceeded,
    GuardTripped,
    NodeVisitLimitExceeded,
    RunGuards,
    WallClockExceeded,
)
from artloupe.metering.pricing import estimate_cost_usd
from artloupe.metering.records import NodeMetric, NodeStatus
from artloupe.schemas import BudgetLedger


class NodeSpan:
    """The node currently executing, and what it has reported spending.

    Mutable on purpose: a node may call `record_usage` more than once — a retry, or two model
    calls in one node — and the span accumulates rather than replaces.
    """

    def __init__(self, node: str, attempt: int) -> None:
        self.node = node
        self.attempt = attempt
        self.started_at = datetime.now(UTC)
        self.model: str | None = None
        self.input_tokens = 0
        self.output_tokens = 0
        self.cache_read_tokens = 0
        self.cache_write_tokens = 0
        self.tool_calls = 0
        self._started = monotonic()

    def record_usage(
        self,
        *,
        model: str | None = None,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
        tool_calls: int = 0,
    ) -> None:
        """Add one call's usage to this node's total."""
        if model is not None:
            # Last writer wins. A node that calls two different models is priced by the
            # second, which is wrong — and is a shape this design should not paper over with
            # an average. Split it into two nodes, or this becomes a list.
            self.model = model
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.cache_read_tokens += cache_read_tokens
        self.cache_write_tokens += cache_write_tokens
        self.tool_calls += tool_calls

    @property
    def elapsed_ms(self) -> int:
        return int((monotonic() - self._started) * 1000)


_ACTIVE_SPAN: ContextVar[NodeSpan | None] = ContextVar("artloupe_active_span", default=None)
_ACTIVE_RECORDER: ContextVar["RunRecorder | None"] = ContextVar(
    "artloupe_active_recorder", default=None
)


def active_span() -> NodeSpan | None:
    """The node currently being measured, if any."""
    return _ACTIVE_SPAN.get()


def active_recorder() -> "RunRecorder | None":
    """The recorder for the run currently executing, if any."""
    return _ACTIVE_RECORDER.get()


def record_usage(
    *,
    model: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    tool_calls: int = 0,
) -> None:
    """Report what the current node spent. A no-op outside an instrumented run."""
    span = _ACTIVE_SPAN.get()
    if span is None:
        return
    span.record_usage(
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
        tool_calls=tool_calls,
    )


@contextmanager
def use_recorder(recorder: "RunRecorder") -> Iterator["RunRecorder"]:
    """Make `recorder` the active one for everything run inside this block.

    A `ContextVar` rather than an argument because asyncio tasks inherit the context they were
    created in: LangGraph spawns a task per node from the coroutine that called `ainvoke`, so
    every node — including parallel branches — sees this recorder without the graph ever
    carrying it.
    """
    token = _ACTIVE_RECORDER.set(recorder)
    try:
        yield recorder
    finally:
        _ACTIVE_RECORDER.reset(token)


class RunRecorder:
    """The ledger for one run, and the guards it enforces.

    Not thread-safe and not intended to be: one run, one recorder, one event loop. Parallel
    graph branches share it through the context, which is safe because they are coroutines on
    the same loop rather than threads.
    """

    def __init__(self, run_id: str, owner: str, guards: RunGuards) -> None:
        self.run_id = run_id
        self.owner = owner
        self.guards = guards
        self.metrics: list[NodeMetric] = []
        self.ledger = BudgetLedger(token_ceiling=guards.token_ceiling)
        self._visits: Counter[str] = Counter()
        self._deadline = monotonic() + guards.wall_clock_seconds

    @property
    def cost_usd(self) -> Decimal:
        """What the run has spent so far, ignoring nodes that could not be priced.

        Deliberately not `None`-poisoned: an unpriced node should not blank out the whole
        run's cost. `unpriced_nodes` is how a caller knows the number is a floor.
        """
        return sum(
            (metric.cost_usd for metric in self.metrics if metric.cost_usd is not None),
            Decimal("0"),
        )

    @property
    def unpriced_nodes(self) -> int:
        """Nodes whose model was not in the price table, so `cost_usd` understates the run."""
        return sum(1 for metric in self.metrics if metric.cost_usd is None)

    @property
    def seconds_remaining(self) -> float:
        return self._deadline - monotonic()

    @asynccontextmanager
    async def node(self, name: str) -> AsyncIterator[NodeSpan]:
        """Measure one node execution, and refuse to start it if a ceiling is already reached."""
        self._guard_entry(name)

        self._visits[name] += 1
        span = NodeSpan(name, attempt=self._visits[name])
        token = _ACTIVE_SPAN.set(span)
        status: NodeStatus = "ok"
        error: str | None = None
        try:
            yield span
        except GuardTripped:
            status = "guard_stopped"
            raise
        except BaseException as exc:
            # `BaseException` so a cancelled node — which is what the run-level timeout
            # backstop produces — still writes its row. The runs worth reading in operations
            # are disproportionately the ones that did not finish.
            status = "error"
            error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            _ACTIVE_SPAN.reset(token)
            self._close(span, status, error)

        # Reached only when the node returned normally. Checked after, not before, because the
        # tokens that may have crossed the ceiling are the ones it just spent.
        self._guard_budget(name)

    def _guard_entry(self, name: str) -> None:
        """Refuse to start a node whose run has already hit a ceiling.

        A refusal writes a zero-duration row before it raises. The node never ran, so the row
        carries no usage — but *where a run stopped* is the question the operations run-health
        panel is asked, and a stop that left no trace answers it with silence.
        """
        try:
            if self.ledger.stopped:
                raise BudgetExceeded(self.ledger.stop_reason or "plan budget exhausted")
            if monotonic() > self._deadline:
                raise WallClockExceeded(
                    f"run exceeded its {self.guards.wall_clock_seconds:g}s deadline before {name!r}"
                )
            if self._visits[name] >= self.guards.node_visit_limit:
                raise NodeVisitLimitExceeded(
                    f"node {name!r} reached its limit of {self.guards.node_visit_limit} "
                    "executions in one run"
                )
        except GuardTripped as tripped:
            self._close(
                NodeSpan(name, attempt=self._visits[name] + 1), "guard_stopped", tripped.reason
            )
            raise

    def _close(self, span: NodeSpan, status: NodeStatus, error: str | None) -> None:
        metric = NodeMetric(
            run_id=self.run_id,
            owner=self.owner,
            node=span.node,
            attempt=span.attempt,
            started_at=span.started_at,
            duration_ms=span.elapsed_ms,
            status=status,
            model=span.model,
            input_tokens=span.input_tokens,
            output_tokens=span.output_tokens,
            cache_read_tokens=span.cache_read_tokens,
            cache_write_tokens=span.cache_write_tokens,
            tool_calls=span.tool_calls,
            cost_usd=estimate_cost_usd(
                span.model,
                input_tokens=span.input_tokens,
                output_tokens=span.output_tokens,
                cache_read_tokens=span.cache_read_tokens,
                cache_write_tokens=span.cache_write_tokens,
            ),
            error=error,
        )
        self.metrics.append(metric)
        self._accumulate(metric)

    def _accumulate(self, metric: NodeMetric) -> None:
        """Fold one node's usage into the shared `BudgetLedger` contract.

        `BudgetLedger.input_tokens` carries cached tokens too. The contract has no field for
        them and the ceiling has to count them, so they land here — the per-node row keeps the
        breakdown that cost needs. Rebuilt rather than mutated so the model validator that
        refuses a stopped ledger with no reason keeps running.
        """
        data = self.ledger.model_dump()
        data["input_tokens"] += (
            metric.input_tokens + metric.cache_read_tokens + metric.cache_write_tokens
        )
        data["output_tokens"] += metric.output_tokens
        data["tool_calls"] += metric.tool_calls
        if metric.cache_read_tokens > 0:
            data["cache_hits"] += 1
        self.ledger = BudgetLedger(**data)

    def _guard_budget(self, name: str) -> None:
        spent = self.ledger.input_tokens + self.ledger.output_tokens
        if spent < self.guards.token_ceiling:
            return
        reason = (
            f"plan budget exhausted: {spent} tokens against a ceiling of "
            f"{self.guards.token_ceiling}, reached in node {name!r}"
        )
        self.ledger = BudgetLedger(
            **{**self.ledger.model_dump(), "stopped": True, "stop_reason": reason}
        )
        raise BudgetExceeded(reason)


def instrumented(name: str, node: Callable[..., Any]) -> Callable[..., Awaitable[Any]]:
    """Wrap a graph node so every execution is measured and guarded.

    Returns an async callable regardless of what it wraps, and calls a synchronous node
    *inline* rather than in a worker thread. That is the whole reason the wrapper exists in
    this shape: `ContextVar`s do not cross a thread boundary, so a node handed to an executor
    would call `record_usage` against no span and silently record nothing. Nodes that block
    should be `async def` and await their IO, which is what they will be anyway.

    With no active recorder the node runs unwrapped. A graph must stay invokable in a unit
    test without a ledger, and the alternative — refusing — would make the untested path the
    convenient one.
    """

    async def run(*args: Any, **kwargs: Any) -> Any:
        recorder = _ACTIVE_RECORDER.get()
        if recorder is None:
            result = node(*args, **kwargs)
            return await result if inspect.isawaitable(result) else result

        async with recorder.node(name):
            result = node(*args, **kwargs)
            return await result if inspect.isawaitable(result) else result

    run.__name__ = getattr(node, "__name__", name)
    run.__doc__ = node.__doc__
    return run
