"""Offline atomic publication and database hybrid retrieval. No paid calls at ingestion."""

import hashlib
import json
import os
import re
import time
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import psycopg
from psycopg.types.json import Jsonb

from artloupe.agent.learning.models import Citation, Passage
from artloupe.agent.learning.retrieval import CorpusUnavailable, Index
from artloupe.config import require_secret

MODEL = "text-embedding-3-small"
DIMENSIONS = 1536


@contextmanager
def connection(*, writer=False):
    name = "ARTLOUPE_LEARNING_INGEST_DATABASE_URL" if writer else "ARTLOUPE_LEARNING_DATABASE_URL"
    dsn = require_secret(name, non_production_value=os.environ.get(name))
    # A connection per operation avoids sharing transactions across FastAPI worker threads.
    # Cloud Run concurrency/max-instances must bound aggregate connections (see runbook).
    with psycopg.connect(dsn, connect_timeout=3) as conn:
        conn.execute(
            "SET LOCAL ROLE artloupe_learning_writer"
            if writer
            else "SET LOCAL ROLE artloupe_learning_reader"
        )
        conn.execute("SET LOCAL search_path = learning, extensions, pg_catalog")
        conn.execute(
            "SET LOCAL statement_timeout = '120s'"
            if writer
            else "SET LOCAL statement_timeout = '3s'"
        )
        yield conn


def vector_literal(vector):
    values = np.asarray(vector, dtype=np.float32)
    if values.shape != (DIMENSIONS,) or not np.isfinite(values).all() or not np.linalg.norm(values):
        raise ValueError("Invalid query vector")
    return "[" + ",".join(str(float(value)) for value in values) + "]"


def publish(directory: Path) -> dict:
    """Validate first, then insert an immutable snapshot and atomically switch active version."""
    started = time.monotonic()
    result = {
        "status": "failed",
        "corpus_version": None,
        "source_count": 0,
        "passage_count": 0,
        "model": MODEL,
        "dimensions": DIMENSIONS,
    }
    try:
        index = Index.load(directory)
        if index.vectors is None:
            raise CorpusUnavailable("Publication requires saved embeddings")
        # Citation validates HTTPS provenance before anything becomes retrievable.
        for part in index.passages:
            Citation(
                id=part.id,
                title=part.title,
                author=part.author,
                locator=part.locator,
                url=part.url,
                license=part.license,
                historical=part.historical,
                excerpt=part.text,
            )
            if not all(
                (part.book_id, part.title, part.author, part.locator, part.license, part.checksum)
            ):
                raise ValueError("Missing passage provenance")
        manifest = json.loads((directory / "manifest.json").read_text())
        embedding_hash = hashlib.sha256((directory / "vectors.npy").read_bytes()).hexdigest()
        result.update(
            corpus_version=index.version,
            source_count=len({p.book_id for p in index.passages}),
            passage_count=len(index.passages),
        )
        with connection(writer=True) as conn:
            # Serialize publishers, including first publication. Readers still see the old snapshot.
            conn.execute("SELECT pg_advisory_xact_lock(19631009)")
            old = conn.execute(
                "SELECT embedding_hash FROM learning.corpora WHERE version = %s", (index.version,)
            ).fetchone()
            if old:
                if old[0] != embedding_hash:
                    raise ValueError("Embedding files changed for an immutable corpus version")
                result["status"] = "unchanged"
            else:
                conn.execute(
                    """INSERT INTO learning.corpora
                    (version, embedding_hash, model, dimensions, passage_count, manifest)
                    VALUES (%s, %s, %s, %s, %s, %s)""",
                    (
                        index.version,
                        embedding_hash,
                        MODEL,
                        DIMENSIONS,
                        len(index.passages),
                        Jsonb(manifest),
                    ),
                )
                with conn.cursor() as cursor:
                    cursor.executemany(
                        """INSERT INTO learning.passages
                        (corpus_version, id, book_id, text, locator, metadata, embedding)
                        VALUES (%s, %s, %s, %s, %s, %s, %s::vector)""",
                        [
                            (
                                index.version,
                                part.id,
                                part.book_id,
                                part.text,
                                part.locator,
                                Jsonb(part.model_dump()),
                                vector_literal(vector),
                            )
                            for part, vector in zip(index.passages, index.vectors, strict=True)
                        ],
                    )
                result["status"] = "published"
            conn.execute(
                """INSERT INTO learning.active_corpus(singleton, version) VALUES (true, %s)
                ON CONFLICT(singleton) DO UPDATE SET version = excluded.version""",
                (index.version,),
            )
            result["duration_seconds"] = time.monotonic() - started
            _record(conn, result)
        return result
    except Exception as error:
        result.update(
            status="failed",
            duration_seconds=time.monotonic() - started,
            failure=type(error).__name__,
        )
        # The rolled-back publication never replaces the active corpus. Record its failure
        # separately; preserve the original exception if the database itself is unavailable.
        try:
            with connection(writer=True) as conn:
                _record(conn, result)
        except Exception:
            pass
        raise


def _record(conn, result):
    conn.execute(
        """INSERT INTO learning.ingestion_runs
        (status, corpus_version, source_count, passage_count, model, dimensions,
         duration_seconds, failure)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        tuple(
            result.get(key)
            for key in (
                "status",
                "corpus_version",
                "source_count",
                "passage_count",
                "model",
                "dimensions",
                "duration_seconds",
                "failure",
            )
        ),
    )


class PostgresIndex:
    # The route uses this capability flag to request a query embedding; no matrix is loaded.
    vectors = True

    def __init__(self, version):
        self.version = version

    @classmethod
    def load(cls):
        try:
            with connection() as conn:
                row = conn.execute(
                    "SELECT version FROM learning.active_corpus WHERE singleton"
                ).fetchone()
            if not row:
                raise CorpusUnavailable("No published learning corpus")
            return cls(row[0])
        except psycopg.Error as error:
            raise CorpusUnavailable("Learning database unavailable") from error

    def search(self, query, vector=None, limit=6, *, locale="en", mode=None):
        mode = mode or ("hybrid" if vector is not None else "keyword")
        if not 1 <= limit <= 30 or mode not in {"keyword", "dense", "hybrid"}:
            raise ValueError("Invalid retrieval options")
        if mode != "keyword" and vector is None:
            raise ValueError("Semantic retrieval requires a query embedding")
        scores = {}
        metadata = {}
        try:
            with connection() as conn:
                if mode != "dense" and (locale != "es" or vector is None):
                    rows = conn.execute(
                        """SELECT id, metadata FROM learning.passages,
                        websearch_to_tsquery('english', %s) q
                        WHERE corpus_version = %s AND tsv @@ q
                        ORDER BY ts_rank_cd(tsv, q) DESC, id LIMIT 30""",
                        (" OR ".join(re.findall(r"[a-z0-9]+", query.lower())), self.version),
                    ).fetchall()
                    for rank, (identity, part) in enumerate(rows, 1):
                        scores[identity] = 1 / (60 + rank)
                        metadata[identity] = part
                if mode != "keyword":
                    rows = conn.execute(
                        """SELECT id, metadata, embedding <=> %s::vector AS distance
                        FROM learning.passages WHERE corpus_version = %s
                        ORDER BY embedding <=> %s::vector LIMIT 30""",
                        (vector_literal(vector), self.version, vector_literal(vector)),
                    ).fetchall()
                    for rank, (identity, part, distance) in enumerate(
                        sorted(rows, key=lambda row: (row[2], row[0])), 1
                    ):
                        if distance <= 0.75:
                            scores[identity] = scores.get(identity, 0) + 1 / (60 + rank)
                            metadata[identity] = part
        except psycopg.Error as error:
            raise CorpusUnavailable("Learning database unavailable") from error
        result, seen = [], set()
        for identity in sorted(scores, key=lambda key: (-scores[key], key)):
            part = Passage.model_validate(metadata[identity])
            fingerprint = (part.book_id, part.text)
            if fingerprint not in seen:
                seen.add(fingerprint)
                result.append(part)
            if len(result) == limit:
                break
        return result
