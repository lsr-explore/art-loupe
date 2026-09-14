"""FR-801: no provider image-generation endpoint is reachable from the Python side.

"Zero image generation. No provider image endpoint is reachable from any graph node." The README
calls this structurally verifiable; until this file it was verified by nothing, and true only
because no provider SDK was installed at all. PR 12 installs the first one.

**This is a denylist, and it says so.** It catches the image-generation SDKs and endpoints named
below. It cannot catch a vendor nobody has listed, so adding a provider means reviewing both lists
in the same pull request. #63 would later narrow the check to the deterministic plate path.

Each check carries a negative fixture proving it fires. A check that has never caught anything
proves nothing about whether it can.
"""

import re
from importlib.metadata import distributions
from pathlib import Path

import pytest

pytestmark = pytest.mark.trace(flow="critique.no-generation", category="safety")

PYTHON_ROOT = Path(__file__).resolve().parents[3]

# Distributions whose purpose is generating or editing images. Installing one fails the suite,
# whether or not anything imports it yet — an installed generator is one import away from a node.
IMAGE_GENERATION_DISTRIBUTIONS = frozenset(
    {
        "diffusers",
        "fal-client",
        "replicate",
        "stability-sdk",
    }
)

# Calls and endpoints that generate or edit images, for providers whose SDKs also do other work.
# OpenAI is the concrete case: `python/.env.example` already expects it for embeddings, and its
# SDK and REST API also generate images.
IMAGE_GENERATION_PATTERNS = (
    re.compile(r"\.images\.(generate|edit|create_variation)\s*\("),
    re.compile(r"/v1/images/(generations|edits|variations)"),
    re.compile(r"\b(gpt-image|dall-e)-\d", re.IGNORECASE),
    re.compile(r"\bimagen-\d", re.IGNORECASE),
    re.compile(r"\.generate_images?\s*\("),
)


def forbidden_distributions(installed: set[str]) -> set[str]:
    """The installed distributions that exist to generate images."""
    return {name for name in installed if name.lower() in IMAGE_GENERATION_DISTRIBUTIONS}


def offending_lines(source: str) -> list[str]:
    """Lines of `source` that call or address an image-generation endpoint."""
    return [
        line.strip()
        for line in source.splitlines()
        if any(pattern.search(line) for pattern in IMAGE_GENERATION_PATTERNS)
    ]


def _shipped_sources() -> list[Path]:
    """Every Python file that ships, in every library and service. Tests are not shipped code."""
    return sorted(
        path
        for pattern in ("libs/*/src/**/*.py", "services/*/src/**/*.py")
        for path in PYTHON_ROOT.glob(pattern)
    )


# ---------------------------------------------------------------------------------------------
# The checks
# ---------------------------------------------------------------------------------------------


def test_no_image_generation_sdk_is_installed() -> None:
    installed = {dist.metadata["Name"] for dist in distributions() if dist.metadata["Name"]}

    assert forbidden_distributions(installed) == set()


def test_the_scan_covers_the_code_that_ships() -> None:
    """The control for the source scan. An empty glob would pass it for the wrong reason."""
    shipped = _shipped_sources()

    assert any(path.parts[-3:] == ("artloupe", "agent", "graph.py") for path in shipped)
    assert any("image_tools" in path.parts for path in shipped)


def test_no_shipped_source_reaches_an_image_generation_endpoint() -> None:
    found = {
        str(path.relative_to(PYTHON_ROOT)): lines
        for path in _shipped_sources()
        if (lines := offending_lines(path.read_text(encoding="utf-8")))
    }

    assert found == {}


# ---------------------------------------------------------------------------------------------
# Negative fixtures: each check fires on what it is meant to catch
# ---------------------------------------------------------------------------------------------


def test_an_installed_generator_is_caught() -> None:
    assert forbidden_distributions({"numpy", "Diffusers", "anthropic"}) == {"Diffusers"}


@pytest.mark.parametrize(
    "line",
    [
        'client.images.generate(model="gpt-image-1", prompt=prompt)',
        "client.images.edit(image=original, prompt=prompt)",
        'httpx.post("https://api.openai.com/v1/images/generations", json=body)',
        'model = "dall-e-3"',
        'client.models.generate_images(model="imagen-4.0-generate-001", prompt=prompt)',
    ],
)
def test_a_generation_call_is_caught(line: str) -> None:
    assert offending_lines(line) == [line]


@pytest.mark.parametrize(
    "line",
    [
        'client.embeddings.create(model="text-embedding-3-small", input=text)',
        'client.messages.create(model="claude-opus-5", messages=messages)',
        "Nothing here generates imagery (FR-801).",
        "plates = make_plates(image, source_checksum=checksum)",
    ],
)
def test_ordinary_calls_are_not_caught(line: str) -> None:
    """Without these, a pattern broad enough to match everything would also pass the checks."""
    assert offending_lines(line) == []
