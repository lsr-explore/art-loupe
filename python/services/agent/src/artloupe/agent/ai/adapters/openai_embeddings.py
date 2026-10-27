"""Existing OpenAI embedding API, without introducing another SDK dependency."""

import asyncio

import httpx
import numpy as np

from artloupe.agent.ai.contracts import EmbeddingResult
from artloupe.agent.ai.resolver import Selection
from artloupe.config import get_openai_api_key


class OpenAIEmbeddingProvider:
    def __init__(self, selection: Selection, client: httpx.AsyncClient):
        self.selection, self.client = selection, client

    async def embed(self, texts: list[str]) -> EmbeddingResult:
        key = await asyncio.to_thread(get_openai_api_key)
        model = self.selection.model
        response = await self.client.post(
            f"{model.endpoint}/v1/embeddings",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": model.model,
                "input": texts,
                "encoding_format": "float",
                "dimensions": model.dimensions,
            },
            timeout=self.selection.settings.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        rows = sorted(payload["data"], key=lambda row: row["index"])
        if [row["index"] for row in rows] != list(range(len(texts))):
            raise ValueError("Embedding response does not match input")
        vectors = [row["embedding"] for row in rows]
        if any(
            len(vector) != model.dimensions
            or not np.isfinite(vector).all()
            or np.linalg.norm(vector) == 0
            for vector in vectors
        ):
            raise ValueError("Invalid embeddings")
        return EmbeddingResult(
            vectors, model.model, model.dimensions, payload["usage"]["total_tokens"]
        )
