"""Optional paid embedding adapter. No SDK dependency; provider secrets use the shared seam."""

import json
from pathlib import Path

import httpx
import numpy as np

from artloupe.agent.learning.retrieval import Index
from artloupe.config import get_openai_api_key

MODEL = "text-embedding-3-small"
DIMENSIONS = 1536


async def embed(client: httpx.AsyncClient, texts: list[str]) -> tuple[list[list[float]], int]:
    response = await client.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {get_openai_api_key()}"},
        json={"model": MODEL, "input": texts, "encoding_format": "float", "dimensions": DIMENSIONS},
        timeout=25,
    )
    response.raise_for_status()
    payload = response.json()
    rows = sorted(payload["data"], key=lambda row: row["index"])
    if [row["index"] for row in rows] != list(range(len(texts))):
        raise ValueError("Embedding response does not match input")
    vectors = [row["embedding"] for row in rows]
    if any(
        len(vector) != DIMENSIONS or not np.isfinite(vector).all() or np.linalg.norm(vector) == 0
        for vector in vectors
    ):
        raise ValueError("Invalid embeddings")
    return vectors, payload["usage"]["total_tokens"]


async def build_vectors(directory: Path) -> dict:
    index = Index.load(directory)
    vectors, tokens = [], 0
    async with httpx.AsyncClient() as client:
        for start in range(0, len(index.passages), 32):
            batch, used = await embed(
                client, [part.text for part in index.passages[start : start + 32]]
            )
            vectors.extend(batch)
            tokens += used
    np.save(directory / "vectors.npy", np.asarray(vectors, dtype=np.float32), allow_pickle=False)
    result = {
        "corpus_version": index.version,
        "model": MODEL,
        "dimensions": DIMENSIONS,
        "tokens": tokens,
    }
    (directory / "vectors.json").write_text(json.dumps(result, indent=2) + "\n")
    return result
