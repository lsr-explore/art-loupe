"""Deterministic extraction, provenance and paragraph-aware chunking. No model calls."""

import hashlib
import json
import posixpath
import re
from collections import Counter
from collections.abc import Iterator
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from artloupe.agent.learning.models import Passage

CHUNK_WORDS = 350
OVERLAP_WORDS = 50
EXTRACTOR_VERSION = "books-v1"


def clean(text: str) -> str:
    text = re.sub(r"(\w)-[ \t]*\n[ \t]*(\w)", r"\1\2", text)
    return re.sub(r"\s+", " ", text).strip()


def epub_sections(path: Path) -> Iterator[tuple[str, str]]:
    """Read XHTML in spine order; keep headings across Gutenberg's split files."""
    heading = "Opening section"
    paragraphs: list[str] = []
    indexing = False
    with ZipFile(path) as archive:
        if sum(item.file_size for item in archive.infolist()) > 100_000_000:
            raise ValueError("EPUB exceeds extraction limit")
        container = ET.fromstring(archive.read("META-INF/container.xml"))
        package_path = next(
            node.attrib["full-path"] for node in container.iter() if node.tag.endswith("rootfile")
        )
        package = ET.fromstring(archive.read(package_path))
        manifest = {
            node.attrib["id"]: node.attrib for node in package.iter() if node.tag.endswith("}item")
        }
        for node in package.iter():
            if not node.tag.endswith("}itemref"):
                continue
            item = manifest[node.attrib["idref"]]
            if item.get("media-type") != "application/xhtml+xml" or "nav" in item.get(
                "properties", ""
            ):
                continue
            member = posixpath.normpath(
                posixpath.join(posixpath.dirname(package_path), item["href"])
            )
            document = ET.fromstring(archive.read(member))
            # Prune boilerplate before walking; otherwise a license heading contaminates chapters.
            for parent in document.iter():
                for child in list(parent):
                    local = child.tag.split("}")[-1]
                    if local in {
                        "head",
                        "script",
                        "style",
                        "nav",
                        "footer",
                        "header",
                    } or "pg-boilerplate" in child.attrib.get("class", ""):
                        parent.remove(child)
            for element in document.iter():
                local = element.tag.split("}")[-1]
                text = clean(" ".join(element.itertext()))
                if local in {"h1", "h2", "h3", "h4"} and text:
                    if paragraphs:
                        yield heading, "\n\n".join(paragraphs)
                    heading, paragraphs = text, []
                    if text.strip().lower() == "index":
                        indexing = True
                elif local in {"p", "blockquote"} and text:
                    nested_blocks = local == "blockquote" and any(
                        descendant is not element
                        and descendant.tag.split("}")[-1] in {"p", "blockquote"}
                        for descendant in element.iter()
                    )
                    if not indexing and not nested_blocks:
                        paragraphs.append(text)
        if paragraphs:
            yield heading, "\n\n".join(paragraphs)


def pdf_sections(path: Path) -> Iterator[tuple[str, str]]:
    from pypdf import PdfReader

    reader = PdfReader(path)
    # Extract the textbook text, then remove recurring headers and credit lines.
    pages = [page.extract_text() or "" for page in reader.pages]
    repeated = Counter(
        line.strip() for page in pages for line in set(page.splitlines()) if line.strip()
    )
    chapter = "Introduction"
    for number, page in enumerate(pages, 1):
        if number <= 8:  # This edition's title, license, and contents; retained in the source PDF.
            continue
        printed = re.search(r"Page\s*\|\s*(\d+)", page)
        for line in page.splitlines():
            if re.match(r"CHAPTER [A-Z]+:", line.strip()):
                chapter = line.strip().title()
        lines = [
            line
            for line in page.splitlines()
            if repeated[line.strip()] < 8 and not re.match(r"^Page\s*\|", line.strip())
        ]
        # Keep prose; omit third-party image attribution blocks and captions from the text corpus.
        prose = []
        for line in lines:
            if re.match(r"^(Figure \d|Artist:|Author:|Source:|License:)", line.strip()):
                continue
            prose.append(line)
        locator = f"{chapter}; PDF page {number}"
        if printed:
            locator += f" (printed page {printed[1]})"
        text = clean("\n".join(prose))
        if text:
            yield locator, text


def chunks(text: str) -> Iterator[str]:
    """Bound chunks without discarding the tail; overlap only inside the same section."""
    words = text.split()
    start = 0
    while start < len(words):
        end = min(start + CHUNK_WORDS, len(words))
        if end < len(words):
            # Prefer a nearby sentence end to an arbitrary word cut.
            for candidate in range(end, max(start + 200, end - 60), -1):
                if words[candidate - 1].endswith((".", "!", "?")):
                    end = candidate
                    break
        yield " ".join(words[start:end])
        if end == len(words):
            break
        start = end - OVERLAP_WORDS


def ingest(books: Path, manifest: Path, output: Path) -> dict:
    specs = json.loads(manifest.read_text())["books"]
    passages = []
    summary = []
    for spec in specs:
        path = books / spec["filename"]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        extract = pdf_sections if path.suffix.lower() == ".pdf" else epub_sections
        count = 0
        for locator, text in extract(path):
            if (
                len(text.split()) < 30
                or "project gutenberg" in locator.lower()
                or locator.lower() in {"contents", "index", "illustrations"}
                or len(locator.strip()) <= 2
            ):
                continue
            for offset, part in enumerate(chunks(text)):
                identity = f"{EXTRACTOR_VERSION}:{spec['id']}:{digest}:{locator}:{offset}:{part}"
                passage = Passage(
                    id=hashlib.sha256(identity.encode()).hexdigest()[:24],
                    book_id=spec["id"],
                    title=spec["title"],
                    author=spec["author"],
                    locator=locator,
                    url=spec["url"],
                    license=spec["license"],
                    historical=spec["historical"],
                    text=part,
                    checksum=digest,
                )
                passages.append(passage)
                count += 1
        if not count:
            raise ValueError(f"No passages extracted from {path.name}")
        summary.append({"id": spec["id"], "sha256": digest, "passages": count})
    if len({part.id for part in passages}) != len(passages):
        raise ValueError("Duplicate passage identifiers")
    output.mkdir(parents=True, exist_ok=True)
    content = "".join(part.model_dump_json() + "\n" for part in passages)
    version = hashlib.sha256(content.encode()).hexdigest()
    # Write the text atomically. Old embedding files fail the version check on reload.
    temporary = output / "corpus.jsonl.tmp"
    temporary.write_text(content)
    temporary.replace(output / "corpus.jsonl")
    result = {
        "extractor": EXTRACTOR_VERSION,
        "corpus_version": version,
        "passages": len(passages),
        "books": summary,
    }
    (output / "manifest.json").write_text(json.dumps(result, indent=2) + "\n")
    return result
