"""Collection-time validation of the ``trace`` marker.

Every test may declare which application flow it verifies and in what respect::

    @pytest.mark.trace(flow="critique.formal-analysis", category="safety")

The catalog of valid flows and categories is ``docs/test-traceability-reports/flows.json``
— the same file ``scripts/reports/traceability-report.mjs`` reads to build the dashboard.
This hook validates the Python half of that contract at **collection**, so a tag pointing
at a renamed or deleted flow fails before a single test runs rather than quietly dropping
out of the matrix.

``--strict-markers`` (see ``pyproject.toml``) catches a typo in the marker *name*; pytest
cannot know our ID catalog, so the *arguments* are validated here. That split is
deliberate.

Bad tags accumulate and report together. Failing on the first one turns a five-minute
rename into five sequential runs.

The tags also drive **selection**, which is the point: a map you can only read is a map
that goes stale, because nobody has a daily reason to keep it right.

    uv run pytest --flow critique.formal-analysis      # everything protecting the gate
    uv run pytest --category safety                # every clinical-safety test
    uv run pytest --flow critique.formal-analysis --category functionality

``-m trace`` still works for "any tagged test" — pytest's own marker expressions cannot
match on keyword arguments, which is why these options exist.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest

if TYPE_CHECKING:
    from collections.abc import Iterator

_REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = _REPO_ROOT / "docs" / "test-traceability-reports" / "flows.json"

_VALID_KEYS = frozenset({"flow", "category"})


@cache
def _catalog() -> tuple[frozenset[str], frozenset[str], dict[str, str]]:
    """Flow ids, canonical categories, and the alias→canonical map.

    Cached: this runs once per session, not once per collected item.
    """
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    flows = frozenset(entry["id"] for entry in data["flows"])
    categories = frozenset(data["categories"])
    aliases = dict(data.get("aliases", {}))
    return flows, categories, aliases


def _problems(item: pytest.Item) -> Iterator[str]:
    flows, categories, aliases = _catalog()

    merged: dict[str, Any] = {}
    positional: list[Any] = []
    # iter_markers yields closest-first (function, then class, then module), which is the
    # precedence we want — so only fill a key the nearest marker did not already set.
    for mark in item.iter_markers(name="trace"):
        positional.extend(mark.args)
        for key, value in mark.kwargs.items():
            merged.setdefault(key, value)

    if positional:
        yield (
            f"`trace` takes keyword arguments only, got positional {positional!r} — "
            'write @pytest.mark.trace(flow="…", category="…")'
        )
        # Stop here. Falling through would also emit "has a `category` but no `flow`" AND
        # "has a `flow` but no `category`" — two contradictory messages about arguments the
        # author never supplied, pointing away from the one real mistake.
        return

    unknown = sorted(set(merged) - _VALID_KEYS)
    if unknown:
        yield f"unknown `trace` argument(s) {', '.join(unknown)} (expected flow, category)"

    flow = merged.get("flow")
    category = merged.get("category")
    if flow is None and category is None:
        return

    if flow is None:
        yield "has a `category` but no `flow`"
    elif flow not in flows:
        yield f"unknown flow {flow!r} — not in {CATALOG_PATH.name}"

    if category is None:
        yield "has a `flow` but no `category`"
    elif category not in categories:
        canonical = aliases.get(category)
        yield (
            f"category {category!r} is not canonical — use {canonical!r}"
            if canonical
            else f"unknown category {category!r} — not in {CATALOG_PATH.name}"
        )


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("traceability")
    group.addoption(
        "--flow",
        action="append",
        default=[],
        metavar="ID",
        help="Only run tests tagged with this flow. Repeatable.",
    )
    group.addoption(
        "--category",
        action="append",
        default=[],
        metavar="NAME",
        help="Only run tests tagged with this category. Repeatable.",
    )


def _tags(item: pytest.Item) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for mark in item.iter_markers(name="trace"):
        for key, value in mark.kwargs.items():
            merged.setdefault(key, value)
    return merged


def _apply_selection(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Filter to the requested flows/categories.

    An unknown value is a usage error rather than an empty run — `--flow raediness…`
    silently selecting nothing is how a green board comes to mean nothing at all.
    """
    wanted_flows = set(config.getoption("flow"))
    wanted_categories = set(config.getoption("category"))
    if not wanted_flows and not wanted_categories:
        return

    flows, categories, aliases = _catalog()
    if unknown := sorted(wanted_flows - flows):
        raise pytest.UsageError(f"--flow: unknown flow(s) {', '.join(unknown)}")
    if unknown := sorted(wanted_categories - categories):
        hint = ", ".join(
            f"{name} (did you mean {aliases[name]}?)" if name in aliases else name
            for name in unknown
        )
        raise pytest.UsageError(f"--category: unknown categor(y/ies) {hint}")

    kept, dropped = [], []
    for item in items:
        tags = _tags(item)
        matches = (not wanted_flows or tags.get("flow") in wanted_flows) and (
            not wanted_categories or tags.get("category") in wanted_categories
        )
        (kept if matches else dropped).append(item)

    if dropped:
        config.hook.pytest_deselected(items=dropped)
        items[:] = kept


def pytest_collection_modifyitems(
    config: pytest.Config,
    items: list[pytest.Item],
) -> None:
    if not CATALOG_PATH.exists():
        # The Python workspace is usable on its own; a missing catalog is not a test
        # failure. The JS-side check is what guarantees the file is present in CI.
        return

    # Deduplicate by (file, problem). A module-level `pytestmark` with a bad flow is one
    # authoring mistake, not 96 of them — reporting it per-item buries the fix.
    seen: dict[tuple[str, str], tuple[str, int]] = {}
    for item in items:
        for problem in _problems(item):
            key = (str(item.path), problem)
            nodeid, count = seen.get(key, (item.nodeid, 0))
            seen[key] = (nodeid, count + 1)

    if seen:
        listed = "\n  ".join(
            f"{nodeid}: {problem}" + (f"  (and {count - 1} more in this file)" if count > 1 else "")
            for (_, problem), (nodeid, count) in seen.items()
        )
        raise pytest.UsageError(
            f"{len(seen)} invalid `trace` marker(s):\n  {listed}\n\n"
            f"Valid flows and categories: {CATALOG_PATH}"
        )

    # Validation first, selection second — a bad tag must fail even on a filtered run,
    # or `--flow x` becomes a way to skip past the thing the gate exists to catch.
    _apply_selection(config, items)
