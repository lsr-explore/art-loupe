"""The Python half of the hand-authored mirror's safety net.

`packages/schemas/src/contract-parity.test.ts` loads the same fixture and asserts the same
things. A field added on one side and forgotten on the other fails here — in the suite that
did not change, which is the only place a drift is cheap to notice.

Tagged `data` rather than `functionality`: every case here is about a contract holding its
shape across a process boundary, not about a feature behaving.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from artloupe.schemas import (
    ArtifactMetadata,
    BudgetLedger,
    Claim,
    ImageRef,
    ProjectIntent,
    ToolManifest,
)

pytestmark = pytest.mark.trace(flow="platform.contracts", category="data")


def _repo_root() -> Path:
    """Walk up to the workspace root, identified by its pnpm workspace manifest.

    Searched rather than hard-coded as `parents[4]`: a relative-depth constant breaks
    silently the first time this file moves, and the failure looks like a missing fixture
    rather than a wrong path.
    """
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "pnpm-workspace.yaml").is_file():
            return candidate
    raise RuntimeError("could not locate the workspace root from the test file")


FIXTURE_PATH = _repo_root() / "packages" / "schemas" / "fixtures" / "contract-parity.json"


def _strip_comments(value: Any) -> Any:
    """Drop the `$comment` annotations the fixture carries for human readers.

    Stripped explicitly rather than relying on both libraries ignoring unknown keys —
    especially here, where every model sets `extra="forbid"` and would reject them.
    """
    if isinstance(value, list):
        return [_strip_comments(entry) for entry in value]
    if isinstance(value, dict):
        return {key: _strip_comments(entry) for key, entry in value.items() if key != "$comment"}
    return value


FIXTURE = _strip_comments(json.loads(FIXTURE_PATH.read_text(encoding="utf-8")))
ACCEPTS = FIXTURE["accepts"]
REJECTS = FIXTURE["rejects"]

SCHEMAS: dict[str, type[BaseModel]] = {
    "claim": Claim,
    "image_ref": ImageRef,
    "project_intent": ProjectIntent,
    "tool_manifest": ToolManifest,
    "artifact_metadata": ArtifactMetadata,
    "budget_ledger": BudgetLedger,
}


@pytest.mark.parametrize("claim", ACCEPTS["claims"], ids=lambda c: c["evidence"]["kind"])
def test_accepts_every_evidence_class(claim: dict[str, Any]) -> None:
    Claim.model_validate(claim)


def test_fixture_covers_the_whole_taxonomy() -> None:
    kinds = {claim["evidence"]["kind"] for claim in ACCEPTS["claims"]}
    assert kinds == {"measured", "cited", "chosen"}


@pytest.mark.parametrize("image", ACCEPTS["image_refs"])
def test_accepts_image_refs(image: dict[str, Any]) -> None:
    ImageRef.model_validate(image)


@pytest.mark.parametrize(
    ("name", "entry"), sorted(ACCEPTS["project_intents"].items()), ids=lambda value: str(value)
)
def test_project_intent_defaults_match_the_mirror(name: str, entry: dict[str, Any]) -> None:
    """The most likely place for a silent drift: a default filled on one side only."""
    parsed = ProjectIntent.model_validate(entry["input"])
    assert parsed.model_dump(mode="json") == entry["expected"], name


@pytest.mark.parametrize("manifest", ACCEPTS["tool_manifests"])
def test_accepts_tool_manifests(manifest: dict[str, Any]) -> None:
    ToolManifest.model_validate(manifest)


@pytest.mark.parametrize("metadata", ACCEPTS["artifact_metadata"], ids=lambda entry: entry["tool"])
def test_accepts_artifact_metadata(metadata: dict[str, Any]) -> None:
    ArtifactMetadata.model_validate(metadata)


def test_null_confidence_is_not_collapsed_to_zero() -> None:
    grayscale = next(
        entry for entry in ACCEPTS["artifact_metadata"] if entry["tool"] == "grayscale"
    )
    assert ArtifactMetadata.model_validate(grayscale).confidence is None


@pytest.mark.parametrize(
    "ledger", ACCEPTS["budget_ledgers"], ids=lambda entry: f"stopped={entry['stopped']}"
)
def test_accepts_budget_ledgers(ledger: dict[str, Any]) -> None:
    BudgetLedger.model_validate(ledger)


@pytest.mark.parametrize(("name", "entry"), sorted(REJECTS.items()), ids=lambda value: str(value))
def test_rejects(name: str, entry: dict[str, Any]) -> None:
    model = SCHEMAS.get(entry["schema"])
    assert model is not None, f"fixture names an unknown schema: {entry['schema']}"
    with pytest.raises(ValidationError):
        model.model_validate(entry["value"])


def test_reject_entries_name_only_known_schemas() -> None:
    named = {entry["schema"] for entry in REJECTS.values()}
    assert named <= set(SCHEMAS)
