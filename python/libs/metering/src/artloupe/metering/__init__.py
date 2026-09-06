"""Metering and guards for one Art Loupe run.

What a run spent — per node, in tokens, milliseconds, and dollars — and the ceilings that stop
it spending more. Every row carries the `run_id` that also identifies the run in studio and in
operations (NFR-09), which is what lets an operations figure be traced back to something an
artist saw.

The ledger here is the **per-project plan budget** (NFR-04). Chat credits (NFR-11) are a
separate meter and neither can stop the other; if exhausted chat credits ever terminate a run,
that is a bug in the separation rather than a budget working.
"""

from artloupe.metering.config import MeteringMode, MeteringSettings, get_settings
from artloupe.metering.guards import (
    BudgetExceeded,
    GuardTripped,
    NodeVisitLimitExceeded,
    RecursionLimitExceeded,
    RunGuards,
    WallClockExceeded,
)
from artloupe.metering.pricing import (
    CACHE_READ_MULTIPLIER,
    CACHE_WRITE_MULTIPLIER,
    MODEL_PRICES,
    ModelPrice,
    estimate_cost_usd,
    price_for,
)
from artloupe.metering.recorder import (
    NodeSpan,
    RunRecorder,
    active_recorder,
    active_span,
    instrumented,
    record_usage,
    use_recorder,
)
from artloupe.metering.records import NodeMetric, NodeStatus
from artloupe.metering.sinks import (
    METRICS_TABLE,
    InMemoryMetricsSink,
    MetricsSink,
    PostgresMetricsSink,
    get_metrics_sink,
)

__all__ = [
    "CACHE_READ_MULTIPLIER",
    "CACHE_WRITE_MULTIPLIER",
    "METRICS_TABLE",
    "MODEL_PRICES",
    "BudgetExceeded",
    "GuardTripped",
    "InMemoryMetricsSink",
    "MeteringMode",
    "MeteringSettings",
    "MetricsSink",
    "ModelPrice",
    "NodeMetric",
    "NodeSpan",
    "NodeStatus",
    "NodeVisitLimitExceeded",
    "PostgresMetricsSink",
    "RecursionLimitExceeded",
    "RunGuards",
    "RunRecorder",
    "WallClockExceeded",
    "active_recorder",
    "active_span",
    "estimate_cost_usd",
    "get_metrics_sink",
    "get_settings",
    "instrumented",
    "price_for",
    "record_usage",
    "use_recorder",
]
