"""What a node's tokens cost, in dollars.

No provider is wired into this repository yet, so nothing here has been exercised against a
real invoice. That is precisely why it exists now rather than later: FR-905 renders
per-node cost, and a cost column added after the first paid call is retroactively blank.

Three decisions worth not re-deriving:

- **`Decimal`, not `float`.** These numbers are summed across every node of every run and
  then shown to an operator as money. Binary floating point accumulates error in exactly
  that pattern, and a cost dashboard that disagrees with the invoice is worse than no
  dashboard.
- **An unknown model prices to `None`, not to zero.** A model can ship before this table is
  updated, and a run must not fail over its own accounting. But `0.00` and "we do not know"
  are different claims, and collapsing them would quietly understate the bill — the
  operations flow's whole risk is a wrong number misleading the operator. `None` is
  reportable; a wrong zero is not.
- **A node with no model prices to zero, and that is a real zero.** Deterministic image
  tools cost nothing per token because they spend no tokens (FR-801: there is no image
  *generation* call to price at all).

Rates are Anthropic first-party API list prices in USD per million tokens. Partner-operated
platforms (Bedrock, Vertex) price separately; if a run ever executes there, this table is
wrong and needs a per-platform key rather than a fudge factor.
"""

from dataclasses import dataclass
from decimal import Decimal

# Anthropic bills cached input at a fraction of the uncached rate, and charges a premium to
# write the cache. These are the published multipliers rather than separate columns, so a
# price change touches one number per model instead of four.
CACHE_READ_MULTIPLIER = Decimal("0.1")
CACHE_WRITE_MULTIPLIER = Decimal("1.25")

_PER_MILLION = Decimal(1_000_000)


@dataclass(frozen=True)
class ModelPrice:
    """List price for one model, in USD per million tokens."""

    input_per_mtok: Decimal
    output_per_mtok: Decimal


# Keyed by the exact model id sent on the wire. No date suffixes: current Claude model ids
# are complete as written, and a suffixed key would simply never match.
MODEL_PRICES: dict[str, ModelPrice] = {
    "claude-opus-5": ModelPrice(Decimal("5.00"), Decimal("25.00")),
    "claude-sonnet-5": ModelPrice(Decimal("2.00"), Decimal("10.00")),
    "claude-haiku-4-5": ModelPrice(Decimal("1.00"), Decimal("5.00")),
}


def price_for(model: str | None) -> ModelPrice | None:
    """The list price for a model id, or `None` if it is not in the table."""
    if model is None:
        return None
    return MODEL_PRICES.get(model)


def estimate_cost_usd(
    model: str | None,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> Decimal | None:
    """Cost of one node's token usage.

    Returns `Decimal("0")` when `model` is `None` — a deterministic node genuinely spends
    nothing — and `None` when a model id is not in `MODEL_PRICES`, which means unpriced
    rather than free. Callers must render those two differently.
    """
    if model is None:
        return Decimal("0")

    price = MODEL_PRICES.get(model)
    if price is None:
        return None

    billable_input = (
        Decimal(input_tokens)
        + Decimal(cache_read_tokens) * CACHE_READ_MULTIPLIER
        + Decimal(cache_write_tokens) * CACHE_WRITE_MULTIPLIER
    )
    return (
        billable_input * price.input_per_mtok + Decimal(output_tokens) * price.output_per_mtok
    ) / _PER_MILLION
