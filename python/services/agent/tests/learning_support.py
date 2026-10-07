"""Synthetic evidence and EPUB input: test-only, not part of the learning corpus."""

import json
from pathlib import Path
from zipfile import ZipFile

from artloupe.agent.learning.models import Passage

PARITY = json.loads(
    (
        Path(__file__).resolve().parents[4] / "packages/schemas/fixtures/learning-parity.json"
    ).read_text()
)


def passage(
    identity="passage-value",
    text="Value describes the relative lightness or darkness of a tone.",
    locator="Chapter 2",
):
    return Passage(
        id=identity,
        book_id="test-book",
        title="Drawing fundamentals",
        author="Test Author",
        locator=locator,
        url="https://www.gutenberg.org/ebooks/14264",
        license="Public domain in the USA",
        historical=True,
        text=text,
        checksum="fixture",
    )


def epub(path):
    with ZipFile(path, "w") as archive:
        archive.writestr(
            "META-INF/container.xml",
            '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootf'
            "iles></container>",
        )
        archive.writestr(
            "OEBPS/content.opf",
            '<package xmlns="urn:opf"><manifest><item id="second" href="second.xhtm'
            'l" media-type="application/xhtml+xml"/><item id="first" href="first.xh'
            'tml" media-type="application/xhtml+xml"/></manifest><spine><itemref id'
            'ref="first"/><itemref idref="second"/></spine></package>',
        )
        archive.writestr(
            "OEBPS/first.xhtml",
            '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Noise</title><'
            '/head><body><header class="pg-boilerplate"><h2>License</h2><p>Do not i'
            "ndex.</p></header><h2>Value</h2><p>Light and dark tones.</p></body></h"
            "tml>",
        )
        archive.writestr(
            "OEBPS/second.xhtml",
            '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Continued paragrap'
            "h.</p><h2>Composition</h2><p>Balance shapes.</p><h2>INDEX</h2><p>Noise"
            " in index.</p></body></html>",
        )
    return path
