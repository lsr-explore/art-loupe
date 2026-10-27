"""A packaged development corpus for the learning mock; it never uses real corpus vectors."""

import hashlib

from artloupe.agent.learning.models import Passage
from artloupe.agent.learning.retrieval import Index


def mock_index() -> Index:
    text = (
        "Mock fixture: value studies group a reference into large light and dark shapes "
        "before adding detail."
    )
    passage = Passage(
        id="mock-values",
        book_id="mock-development",
        title="Mock development lesson",
        author="Art Loupe fixtures",
        locator="Fixture 1",
        url="https://example.invalid/artloupe/mock-values",
        license="Development fixture, not a published source.",
        historical=False,
        text=text,
        checksum=hashlib.sha256(text.encode()).hexdigest(),
    )
    return Index([passage], "mock-fixture-v1")
