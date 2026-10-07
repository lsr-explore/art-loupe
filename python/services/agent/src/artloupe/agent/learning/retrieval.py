"""Shared retrieval engine used by the HTTP service and eval runner. BM25 + optional cosine RRF."""

import hashlib
import json
import math
import os
import re
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path

import numpy as np

from artloupe.agent.learning.models import Passage

STOPWORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "to",
        "of",
        "and",
        "or",
        "in",
        "on",
        "with",
        "for",
        "from",
        "at",
        "by",
        "as",
        "it",
        "its",
        "this",
        "that",
        "these",
        "those",
        "i",
        "my",
        "me",
        "you",
        "your",
        "how",
        "what",
        "why",
        "can",
        "could",
        "should",
        "would",
        "do",
        "does",
        "did",
        "about",
        "please",
        "explain",
        "tell",
        "use",
        "using",
        "draw",
        "drawing",
        "paint",
        "painting",
        "art",
        "artist",
        "artists",
        "painter",
        "painters",
        "picture",
        "pictures",
        "great",
        "give",
        "say",
        "says",
        "consider",
    }
)


def terms(text: str) -> list[str]:
    words = re.findall(r"[a-z]+", text.lower())
    return [word for word in words if len(word) > 2 and word not in STOPWORDS]


class CorpusUnavailable(RuntimeError):
    pass


class Index:
    def __init__(self, passages: list[Passage], version: str, vectors=None):
        if not passages:
            raise CorpusUnavailable("Empty corpus")
        self.passages = passages
        self.version = version
        self.vectors = vectors
        self.postings = defaultdict(dict)
        self.lengths = []
        for number, passage in enumerate(passages):
            tokens = terms(passage.text + " " + passage.locator)
            self.lengths.append(len(tokens))
            for term, frequency in Counter(tokens).items():
                self.postings[term][number] = frequency
        self.average = sum(self.lengths) / len(self.lengths)

    @classmethod
    def load(cls, directory: Path):
        try:
            raw = (directory / "corpus.jsonl").read_bytes()
            version = hashlib.sha256(raw).hexdigest()
            manifest = json.loads((directory / "manifest.json").read_text())
            if version != manifest["corpus_version"]:
                raise ValueError("Corpus checksum mismatch")
            passages = [
                Passage.model_validate_json(line) for line in raw.decode().splitlines() if line
            ]
            if len({part.id for part in passages}) != len(passages):
                raise ValueError("Duplicate passage identifiers")
            vectors = None
            if (directory / "vectors.npy").exists():
                meta = json.loads((directory / "vectors.json").read_text())
                if meta["corpus_version"] != version or meta["model"] != "text-embedding-3-small":
                    raise ValueError("Embeddings do not match this corpus")
                vectors = np.load(directory / "vectors.npy", allow_pickle=False)
                if vectors.shape != (len(passages), 1536) or not np.isfinite(vectors).all():
                    raise ValueError("Invalid embedding matrix")
                norms = np.linalg.norm(vectors, axis=1, keepdims=True)
                if (norms == 0).any():
                    raise ValueError("Zero embedding")
                vectors = vectors / norms
            return cls(passages, version, vectors)
        except (OSError, ValueError, KeyError) as error:
            raise CorpusUnavailable("Learning corpus is missing or invalid") from error

    def search(self, query: str, vector=None, limit: int = 6) -> list[Passage]:
        scores = defaultdict(float)
        for term in set(terms(query)):
            postings = self.postings.get(term, {})
            weight = math.log(
                1 + (len(self.passages) - len(postings) + 0.5) / (len(postings) + 0.5)
            )
            for number, frequency in postings.items():
                scores[number] += (
                    weight
                    * frequency
                    * 2.5
                    / (frequency + 1.5 * (0.25 + 0.75 * self.lengths[number] / self.average))
                )
        keyword = sorted(scores, key=lambda number: (-scores[number], self.passages[number].id))[
            :30
        ]
        fused = defaultdict(float)
        for rank, number in enumerate(keyword, 1):
            fused[number] += 1 / (60 + rank)
        if vector is not None:
            if self.vectors is None:
                raise ValueError("No indexed vectors")
            query_vector = np.asarray(vector, dtype=np.float32)
            if (
                query_vector.shape != (1536,)
                or not np.isfinite(query_vector).all()
                or np.linalg.norm(query_vector) == 0
            ):
                raise ValueError("Invalid query vector")
            similarities = self.vectors @ (query_vector / np.linalg.norm(query_vector))
            semantic = np.argsort(-similarities, kind="stable")[:30]
            # Cosine is a retrieval heuristic, never a probability of truth.
            for rank, number in enumerate(semantic, 1):
                if similarities[number] >= 0.25:
                    fused[int(number)] += 1 / (60 + rank)
        ranked = sorted(fused, key=lambda number: (-fused[number], self.passages[number].id))
        result = []
        seen = set()
        for number in ranked:
            passage = self.passages[number]
            fingerprint = (passage.book_id, passage.text)
            if fingerprint not in seen:
                seen.add(fingerprint)
                result.append(passage)
            if len(result) == limit:
                break
        return result


@lru_cache(maxsize=2)
def load_index(directory: str) -> Index:
    return Index.load(Path(directory))


def configured_index() -> Index:
    directory = os.environ.get("ARTLOUPE_LEARNING_CORPUS")
    if not directory:
        raise CorpusUnavailable("Learning corpus not configured")
    return load_index(directory)
