"""What a node's tokens cost, and the difference between free and unpriced.

Tagged `ops.observability` rather than `platform.agent-runtime`: nothing here changes what a
run does. It changes what an operator is told a run cost, and a wrong number there is the
failure this flow exists to catch.
"""

import re
from decimal import Decimal

import pytest

from artloupe.metering.pricing import (
    CACHE_READ_MULTIPLIER,
    CACHE_WRITE_MULTIPLIER,
    MODEL_PRICES,
    estimate_cost_usd,
    price_for,
)

pytestmark = pytest.mark.trace(flow="ops.observability", category="functionality")


def test_cost_is_decimal_not_float() -> None:
    """These are summed across every node of every run and then shown as money.

    Binary floating point accumulates error in exactly that pattern, and a cost dashboard
    that disagrees with the invoice is worse than no dashboard.
    """
    cost = estimate_cost_usd("claude-opus-5", input_tokens=1_000_000, output_tokens=0)
    assert isinstance(cost, Decimal)
    assert cost == Decimal("5.00")


def test_input_and_output_are_priced_separately() -> None:
    cost = estimate_cost_usd("claude-opus-5", input_tokens=1_000_000, output_tokens=1_000_000)
    assert cost == Decimal("30.00")


def test_cached_input_is_cheaper_and_writing_the_cache_is_dearer() -> None:
    """Folding cache tokens into the plain input rate would overstate reads ten-fold."""
    read = estimate_cost_usd("claude-opus-5", cache_read_tokens=1_000_000)
    written = estimate_cost_usd("claude-opus-5", cache_write_tokens=1_000_000)
    assert read == Decimal("5.00") * CACHE_READ_MULTIPLIER
    assert written == Decimal("5.00") * CACHE_WRITE_MULTIPLIER
    assert read < written


def test_a_node_with_no_model_costs_a_real_zero() -> None:
    """A deterministic image tool spends no tokens — that zero is a measurement, not a gap."""
    assert estimate_cost_usd(None, input_tokens=0, output_tokens=0) == Decimal("0")


def test_an_unknown_model_is_unpriced_rather_than_free() -> None:
    """The distinction the whole flow turns on.

    A model can ship before this table is updated, and a run must not fail over its own
    accounting. But returning `0` would quietly understate the bill, and understating it is
    indistinguishable from a cheap run — which is the wrong number misleading the operator
    that `ops.observability` is severity-rated for.
    """
    assert estimate_cost_usd("claude-not-yet-released", input_tokens=1_000_000) is None
    assert price_for("claude-not-yet-released") is None


def test_model_ids_carry_no_date_suffix() -> None:
    """Current Claude model ids are complete as written; a dated key would never match.

    A stale habit from older model names, and the failure is silent: an unmatched key prices
    to `None`, so every row for that model reads as unpriced rather than as wrong.
    """
    for model in MODEL_PRICES:
        assert re.search(r"-\d{8}$", model) is None
