"""Optional paid embedding adapter. No SDK dependency; provider secrets use the shared seam."""

import json
from pathlib import Path

import httpx
import numpy as np

from artloupe.agent.ai.adapters.mock import MockEmbeddingProvider
from artloupe.agent.ai.adapters.openai_embeddings import OpenAIEmbeddingProvider
from artloupe.agent.ai.registry import ConfigurationError
from artloupe.agent.ai.resolver import resolve_task
from artloupe.agent.learning.retrieval import Index
from artloupe.metering import active_span

MODEL = "text-embedding-3-small"
DIMENSIONS = 1536


async def embed(client: httpx.AsyncClient, texts: list[str]) -> tuple[list[list[float]], int]:
    selection = resolve_task("learning-embeddings")
    if selection.model.provider == "mock":
        adapter = MockEmbeddingProvider()
    else:
        adapter = OpenAIEmbeddingProvider(selection, client)
    span = active_span()
    trace = dict(
        task="learning-embeddings",
        provider=selection.model.provider,
        model_id=selection.model_id,
        requested_model=selection.model.model,
        dimensions=selection.model.dimensions,
    )
    if span is not None:
        span.inference.append(trace)
    result = await adapter.embed(texts)
    trace["actual_model"] = result.model
    return result.vectors, result.tokens


async def build_vectors(directory: Path) -> dict:
    if resolve_task("learning-embeddings").model.provider == "mock":
        raise ConfigurationError("Mock embeddings cannot be published into a real corpus index")
    index = Index.load(directory, include_vectors=False)
    vectors, tokens = [], 0
    async with httpx.AsyncClient() as client:
        for start in range(0, len(index.passages), 32):
            batch, used = await embed(
                client, [part.text for part in index.passages[start : start + 32]]
            )
            vectors.extend(batch)
            tokens += used
    result = {
        "corpus_version": index.version,
        "model": MODEL,
        "dimensions": DIMENSIONS,
        "tokens": tokens,
    }
    # Complete both temporary files before publishing either; retries ignore old vectors.
    vector_file = directory / "vectors.npy.tmp"
    with vector_file.open("wb") as stream:
        np.save(stream, np.asarray(vectors, dtype=np.float32), allow_pickle=False)
    metadata_file = directory / "vectors.json.tmp"
    metadata_file.write_text(json.dumps(result, indent=2) + "\n")
    vector_file.replace(directory / "vectors.npy")
    metadata_file.replace(directory / "vectors.json")
    return result
