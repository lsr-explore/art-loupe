"""Injection screening for untrusted text (FR-106, FR-505, FR-803).

The Python half of a hand-authored mirror. `packages/schemas/src/screening.ts` is the other
half, and neither owns the rules: both load `packages/schemas/fixtures/screening-rules.json`
and both run the case corpus inside it, so a rule that behaves differently under two regex
engines fails in the suite that did not change. Same arrangement as `contract-parity.json`,
for the same reason.

Five surfaces carry text this system did not write -- a filename, an uploaded photograph's
EXIF block, whatever is legible in its pixels, the artist's own free-text goal, and the
documents retrieval brings back. All five are **data**. Screening records what arrived and
never acts on it. Nothing in slice 1 branches on a detection, and that is worth stating here
because a reader looking for the enforcement will not find one and should not add one without
deciding what enforcement means.

The goal is on that list not because the artist is untrusted but because the field is where
pasted text arrives, and it reaches a model prompt in PR 12. FR-1013 still holds: an artist
assertion is intent, never evidence.

Python screens the retrieved-document surface; the Next route handler screens filename, EXIF
and the goal at ingest. That split is why the screener is shared rather than living in either.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, cast

__all__ = [
    "EXCERPT_MAX_LENGTH",
    "SCREENED_SURFACES",
    "Detection",
    "DetectionSeverity",
    "ScreenedSurface",
    "rules_fixture_path",
    "screen_text",
    "screen_values",
]

#: The closed set of surfaces that carry text nobody in this system wrote.
SCREENED_SURFACES: tuple[str, ...] = (
    "filename",
    "exif",
    "ocr",
    "project-goal",
    "retrieved-document",
)

ScreenedSurface = Literal["filename", "exif", "ocr", "project-goal", "retrieved-document"]

#: Ranking only -- see the fixture's ``$severity`` note. Nothing decides behaviour from it.
DetectionSeverity = Literal["high", "medium"]

#: Longest excerpt kept for a match, in characters. Mirrors the TypeScript constant.
EXCERPT_MAX_LENGTH = 160

#: Characters of context kept on each side of a match, budget permitting.
_EXCERPT_CONTEXT = 24

#: Deepest nesting walked inside a decoded EXIF block. See ``screen_values``.
_MAX_DEPTH = 8

_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class Detection:
    """One rule firing on one surface.

    Frozen because a detection is a record of what arrived. Amending one after the fact is
    not a thing this system does -- the ``screening_detections`` table withholds UPDATE for
    the same reason.
    """

    surface: str
    #: Rule id from the shared fixture, e.g. ``instruction-override``.
    rule_id: str
    severity: str
    #: A bounded window of the text that matched, so a human can see what arrived. Bounded
    #: because a retrieved document may be any length and an unbounded excerpt would make
    #: the detections table a second copy of it.
    excerpt: str


def rules_fixture_path() -> Path:
    """Locate the shared rules fixture by walking up to the workspace root.

    Searched rather than hard-coded at a relative depth: a depth constant breaks silently
    the first time this file moves, and the failure reads as a missing fixture rather than a
    wrong path. Identified by the pnpm workspace manifest, which is the one marker that sits
    at the polyglot root rather than inside either language's tree.

    This resolves inside the workspace, which is where the package is installed from today
    (``uv`` puts every member on the path editable). Shipping the fixture as package data is
    the follow-up if a wheel is ever built from this package -- at that point the TypeScript
    side would need the same treatment, and the fixture would want a home that is neither
    package's.
    """
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "pnpm-workspace.yaml").is_file():
            return candidate / "packages" / "schemas" / "fixtures" / "screening-rules.json"
    raise RuntimeError("could not locate the workspace root from the screening module")


@lru_cache(maxsize=1)
def _compiled_rules() -> tuple[tuple[str, str, tuple[re.Pattern[str], ...]], ...]:
    """Load and compile the shared rules once.

    ``IGNORECASE | MULTILINE``, matching the TypeScript mirror's ``i`` and ``m`` flags. The
    multiline flag is the load-bearing one: several rules anchor with ``^`` to stay quiet on
    ordinary prose -- ``system:`` opening a line is a turn marker, mid-sentence it is an
    artist describing a subject -- and without it that anchor would only ever see the first
    line of a multi-line EXIF field.
    """
    document = json.loads(rules_fixture_path().read_text(encoding="utf-8"))
    return tuple(
        (
            rule["id"],
            rule["severity"],
            tuple(
                re.compile(pattern, re.IGNORECASE | re.MULTILINE) for pattern in rule["patterns"]
            ),
        )
        for rule in document["rules"]
    )


def _excerpt_around(value: str, start: int, end: int) -> str:
    """Trim a match down to a readable window.

    Whitespace is collapsed first. Hostile text arrives with newlines and padding in it
    deliberately, and an excerpt that preserved them would wrap one log line into a screenful.
    """
    window_start = max(0, start - _EXCERPT_CONTEXT)
    window_end = min(len(value), end + _EXCERPT_CONTEXT)
    window = _WHITESPACE.sub(" ", value[window_start:window_end]).strip()

    if len(window) <= EXCERPT_MAX_LENGTH:
        return window
    return window[: EXCERPT_MAX_LENGTH - 1] + "…"


def screen_text(surface: str, value: str) -> list[Detection]:
    """Screen one string.

    At most one detection per rule, even when a rule matches several times: the excerpt shows
    a human what kind of thing arrived, and ten excerpts of one rule from a single poisoned
    document is noise rather than ten times the evidence.
    """
    if not value:
        return []

    detections: list[Detection] = []
    for rule_id, severity, patterns in _compiled_rules():
        for pattern in patterns:
            match = pattern.search(value)
            if match is None:
                continue
            detections.append(
                Detection(
                    surface=surface,
                    rule_id=rule_id,
                    severity=severity,
                    excerpt=_excerpt_around(value, match.start(), match.end()),
                )
            )
            break

    return detections


def screen_values(surface: str, value: Any) -> list[Detection]:
    """Screen every string reachable inside a decoded EXIF block or a retrieved document.

    Walks the structure rather than serializing it. ``json.dumps`` would have been one line
    and would have introduced two bugs: the quoting and bracing it inserts can create or
    destroy a match at a value boundary, and the excerpt would then point at a location in a
    serialization the artist never sent.

    Keys are walked as well as values -- XMP and IPTC let the writer name their own
    properties, so a key is no more trustworthy than the thing it labels.
    """
    seen_rules: set[str] = set()
    detections: list[Detection] = []

    def visit(node: Any, depth: int) -> None:
        # Bounded because EXIF is attacker-supplied *structure* as well as attacker-supplied
        # text: a deeply nested maker note would otherwise recurse until the stack gave out.
        if depth > _MAX_DEPTH:
            return

        if isinstance(node, str):
            for detection in screen_text(surface, node):
                if detection.rule_id in seen_rules:
                    continue
                seen_rules.add(detection.rule_id)
                detections.append(detection)
            return

        if isinstance(node, (list, tuple)):
            for entry in cast("list[Any]", node):
                visit(entry, depth + 1)
            return

        if isinstance(node, dict):
            for key, entry in cast("dict[Any, Any]", node).items():
                visit(key, depth + 1)
                visit(entry, depth + 1)

    visit(value, 0)
    return detections
