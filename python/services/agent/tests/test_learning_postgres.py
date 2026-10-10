"""Real database publication/retrieval contract. Explicit disposable database only."""

import hashlib
import json
import os

import numpy as np
import psycopg
import pytest
from learning_support import passage

from artloupe.agent.learning.postgres import PostgresIndex, connection, publish
from artloupe.agent.learning.retrieval import CorpusUnavailable, configured_index

pytestmark = pytest.mark.trace(flow="retrieval.grounding", category="safety")


def corpus(directory, *, changed=False):
    directory.mkdir(exist_ok=True)
    parts = [
        passage(),
        passage("perspective", "Perspective uses converging lines and vanishing points."),
    ]
    if changed:
        parts[0] = passage(text="Value separates the relative brightness of light and dark tones.")
    raw = "".join(part.model_dump_json() + "\n" for part in parts)
    version = hashlib.sha256(raw.encode()).hexdigest()
    (directory / "corpus.jsonl").write_text(raw)
    (directory / "manifest.json").write_text(json.dumps({"corpus_version": version}))
    vectors = np.zeros((2, 1536), dtype=np.float32)
    vectors[0, 0] = vectors[1, 1] = 1
    np.save(directory / "vectors.npy", vectors)
    (directory / "vectors.json").write_text(
        json.dumps({"corpus_version": version, "model": "text-embedding-3-small"})
    )
    return vectors


@pytest.fixture
def database(monkeypatch):
    dsn = os.environ.get("ARTLOUPE_TEST_LEARNING_DATABASE_URL")
    if not dsn:
        pytest.skip("Set ARTLOUPE_TEST_LEARNING_DATABASE_URL to a disposable migrated database")
    monkeypatch.setenv("APP_ENV", "ci")
    monkeypatch.setenv("ARTLOUPE_LEARNING_DATABASE_URL", dsn)
    monkeypatch.setenv("ARTLOUPE_LEARNING_INGEST_DATABASE_URL", dsn)
    with psycopg.connect(dsn) as conn:
        conn.execute(
            "TRUNCATE learning.active_corpus, learning.passages, learning.corpora, "
            "learning.ingestion_runs RESTART IDENTITY"
        )
    return dsn


def test_real_publication_hybrid_retrieval_and_immutable_snapshots(database, tmp_path, monkeypatch):
    vectors = corpus(tmp_path / "first")
    with pytest.raises(CorpusUnavailable):
        PostgresIndex.load()
    result = publish(tmp_path / "first")
    assert result["status"] == "published"
    assert publish(tmp_path / "first")["status"] == "unchanged"
    monkeypatch.setenv("ARTLOUPE_RETRIEVAL_BACKEND", "pgvector")
    monkeypatch.delenv("ARTLOUPE_LEARNING_CORPUS", raising=False)
    index = configured_index()
    assert index.search("vanishing points", mode="keyword")[0].id == "perspective"
    assert index.search("brightness", vectors[0], mode="dense")[0].id == "passage-value"
    assert index.search("vanishing points", vectors[1])[0].locator == "Chapter 2"
    assert index.search("claridad", vectors[0], locale="es")[0].id == "passage-value"
    assert index.search("transmission warranty", mode="keyword") == []
    unrelated = np.zeros(1536)
    unrelated[2] = 1
    assert index.search("transmission warranty", unrelated) == []
    corpus(tmp_path / "second", changed=True)
    newer = publish(tmp_path / "second")
    assert configured_index().version == newer["corpus_version"] != index.version
    assert "lightness" in index.search("value", vectors[0])[0].text
    with connection() as conn:
        assert conn.execute("SELECT count(*) FROM learning.ingestion_runs").fetchone()[0] == 3
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("DELETE FROM learning.passages")


def test_failed_publication_preserves_active_corpus_and_records_failure(database, tmp_path):
    corpus(tmp_path / "good")
    publish(tmp_path / "good")
    original = PostgresIndex.load().version
    corpus(tmp_path / "bad", changed=True)
    np.save(tmp_path / "bad/vectors.npy", np.zeros((2, 1536)))
    with pytest.raises(CorpusUnavailable):
        publish(tmp_path / "bad")
    assert PostgresIndex.load().version == original
    with connection() as conn:
        assert conn.execute(
            "SELECT status, failure FROM learning.ingestion_runs ORDER BY id DESC LIMIT 1"
        ).fetchone() == ("failed", "CorpusUnavailable")


def test_database_role_failure_is_explicit(database, monkeypatch):
    monkeypatch.setenv(
        "ARTLOUPE_LEARNING_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:1/postgres"
    )
    with pytest.raises(CorpusUnavailable):
        PostgresIndex.load()


def test_database_write_failure_rolls_back_partial_publication(database, tmp_path):
    corpus(tmp_path / "good")
    publish(tmp_path / "good")
    original = PostgresIndex.load().version
    corpus(tmp_path / "second", changed=True)
    # Force the second passage insert to fail after the first has been submitted.
    with psycopg.connect(database) as conn:
        conn.execute(
            """ALTER TABLE learning.passages ADD CONSTRAINT test_reject_new_perspective
            CHECK (corpus_version = '"""
            + original
            + """' OR id <> 'perspective') NOT VALID"""
        )
    try:
        with pytest.raises(psycopg.errors.CheckViolation):
            publish(tmp_path / "second")
        assert PostgresIndex.load().version == original
        with connection() as conn:
            assert conn.execute("SELECT count(*) FROM learning.corpora").fetchone()[0] == 1
            assert conn.execute("SELECT count(*) FROM learning.passages").fetchone()[0] == 2
            assert conn.execute(
                "SELECT status, failure FROM learning.ingestion_runs ORDER BY id DESC LIMIT 1"
            ).fetchone() == ("failed", "CheckViolation")
    finally:
        with psycopg.connect(database) as conn:
            conn.execute(
                "ALTER TABLE learning.passages DROP CONSTRAINT test_reject_new_perspective"
            )
