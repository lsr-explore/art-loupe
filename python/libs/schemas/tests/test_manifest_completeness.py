"""The producer's completeness check: every offered tool named exactly once (FR-307).

It lives beside the contract rather than on it (routing-plan §10, question 2), so these cases pin
the one property that choice depends on. The check is judged against the offer, never against
today's `TOOLS`.
"""

import pytest

from artloupe.schemas import (
    TOOLS,
    IncompleteManifest,
    ToolDeclination,
    ToolManifest,
    ToolSelection,
    check_accounts_for,
)

pytestmark = pytest.mark.trace(flow="intake.project-intent", category="functionality")

OFFERED = ("grayscale", "value_map", "perspective")


def _manifest(selected: list[str], declined: list[str]) -> ToolManifest:
    return ToolManifest(
        selected=[ToolSelection(tool=tool) for tool in selected],
        declined=[ToolDeclination(tool=tool, reason="not needed here") for tool in declined],
    )


def test_a_manifest_naming_every_offered_tool_once_passes() -> None:
    check_accounts_for(_manifest(["grayscale", "value_map"], ["perspective"]), OFFERED)


def test_completeness_is_judged_against_the_offer_not_every_tool() -> None:
    """A stored manifest must keep reloading as `TOOLS` grows, so `TOOLS` is not the yardstick."""
    assert len(TOOLS) > len(OFFERED)
    check_accounts_for(_manifest(["grayscale", "value_map", "perspective"], []), OFFERED)


def test_an_omitted_tool_is_refused_and_named() -> None:
    with pytest.raises(IncompleteManifest, match="not accounted for: perspective"):
        check_accounts_for(_manifest(["grayscale", "value_map"], []), OFFERED)


def test_a_tool_named_twice_is_refused() -> None:
    with pytest.raises(IncompleteManifest, match="named more than once: grayscale"):
        check_accounts_for(
            _manifest(["grayscale", "grayscale", "value_map"], ["perspective"]), OFFERED
        )


def test_a_tool_that_was_not_offered_is_refused() -> None:
    with pytest.raises(IncompleteManifest, match="not offered: head_construction"):
        check_accounts_for(
            _manifest(["grayscale", "value_map", "head_construction"], ["perspective"]), OFFERED
        )


def test_every_problem_is_reported_together() -> None:
    with pytest.raises(IncompleteManifest) as caught:
        check_accounts_for(_manifest(["grayscale", "grayscale", "outline"], []), OFFERED)

    message = str(caught.value)
    assert "not accounted for: perspective, value_map" in message
    assert "named more than once: grayscale" in message
    assert "not offered: outline" in message
