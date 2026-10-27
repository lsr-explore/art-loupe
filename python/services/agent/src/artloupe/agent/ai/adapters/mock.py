"""Deterministic, task-aware fixtures. No credentials, sockets, downloads or paid clients."""

import hashlib
import json

from artloupe.agent.ai.contracts import Completion, EmbeddingResult, TextRequest
from artloupe.agent.ai.inputs import input_data
from artloupe.agent.ai.registry import ROOT, ConfigurationError


class MockTextProvider:
    provider = "mock"

    async def generate(self, request: TextRequest) -> Completion:
        task = request.selection.task
        data = input_data(task, request.user)
        result = json.loads((ROOT / "fixtures" / f"{task}.json").read_text())
        if task == "director":
            result["selected"] = [{"tool": tool, "reason": None} for tool in data["offered"]]
        elif task == "analyst":
            result["findings"] = [
                {
                    "finding_id": part["finding_id"],
                    "text": (
                        f"Mock finding: recorded figures for {part['tool']} are "
                        f"{json.dumps(part['figures'], sort_keys=True)}."
                    ),
                }
                for part in data["catalog"]
            ]
        elif task == "planner":
            result["stages"][0]["minutes"] = data["intent"]["time_budget_minutes"]
            if data["findings"]:
                finding = data["findings"][0]
                result["assessment"]["claims"] = [
                    {
                        "text": finding["text"],
                        "basis": "finding",
                        "source": finding["finding_id"],
                        "reason": None,
                        "rejected_alternative": None,
                    }
                ]
        elif task == "learning-answer" and data["passages"]:
            part = data["passages"][0]
            result.update(
                status="answered",
                claims=[{"text": part["text"][:1400], "citation_ids": [part["id"]]}],
                practice="Mock response for development: review the cited fixture passage.",
                gap=None,
            )
        validated = request.schema.model_validate(result)
        return Completion(validated.model_dump_json(), "mock:fixture-v1", "end_turn")


class MockEmbeddingProvider:
    async def embed(self, texts: list[str]) -> EmbeddingResult:
        if any(not isinstance(text, str) for text in texts):
            raise ConfigurationError("Embedding inputs must be strings")
        vectors = [
            [(value - 127.5) / 128 for value in hashlib.shake_256(text.encode()).digest(1536)]
            for text in texts
        ]
        return EmbeddingResult(vectors, "mock:fixture-v1", 1536, 0)
