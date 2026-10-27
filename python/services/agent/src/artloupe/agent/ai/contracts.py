"""Provider-neutral inference contracts. Domains keep ownership of their Pydantic schemas."""

from dataclasses import dataclass, field
from typing import Protocol

from pydantic import BaseModel

from artloupe.agent.ai.resolver import Selection


@dataclass(frozen=True)
class TextRequest:
    selection: Selection
    system: str
    user: str
    schema: type[BaseModel]


@dataclass(frozen=True)
class TokenUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0


@dataclass(frozen=True)
class Completion:
    text: str | None
    model: str
    finish_reason: str
    usage: TokenUsage = field(default_factory=TokenUsage)
    refusal_category: str | None = None


class TextProvider(Protocol):
    provider: str

    async def generate(self, request: TextRequest) -> Completion: ...


@dataclass(frozen=True)
class EmbeddingResult:
    vectors: list[list[float]]
    model: str
    dimensions: int
    tokens: int


class EmbeddingProvider(Protocol):
    async def embed(self, texts: list[str]) -> EmbeddingResult: ...


class ProviderUnavailable(RuntimeError):
    """The configured provider failed; safe to map onto an upstream failure response."""
