"""Validated, non-secret configuration. Provider adapters remain the capability authority."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

ROOT = Path(__file__).resolve().parent
Capability = Literal["structured-text", "streaming", "embeddings"]
TASK_NAMES = {
    "director",
    "analyst",
    "planner",
    "critic",
    "learning-answer",
    "learning-judge",
    "learning-embeddings",
}


class ConfigurationError(ValueError):
    """Actionable configuration error; never contains credential values or user inputs."""


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)


class ModelSpec(Strict):
    provider: Literal["anthropic", "openai", "mock"]
    model: str = Field(min_length=1)
    capabilities: frozenset[Capability]
    credential: Literal["anthropic", "openai"] | None = None
    endpoint: str | None = None
    max_output_tokens: int | None = Field(default=None, gt=0, le=32000)
    dimensions: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def compatible(self):
        supported = {
            "anthropic": {"structured-text", "streaming"},
            "openai": {"embeddings"},
            "mock": {"structured-text", "streaming", "embeddings"},
        }
        if not self.capabilities or not self.capabilities <= supported[self.provider]:
            raise ValueError("Provider adapter does not support the declared capabilities")
        if self.provider == "mock":
            if self.credential is not None or self.endpoint is not None:
                raise ValueError("Mocks must have no credentials or endpoint")
        elif (
            self.credential != self.provider or self.endpoint != f"https://api.{self.provider}.com"
        ):
            raise ValueError("Use the provider's credential reference and first-party endpoint")
        if "embeddings" in self.capabilities and self.dimensions is None:
            raise ValueError("Embedding models require dimensions")
        if "structured-text" in self.capabilities and self.max_output_tokens is None:
            raise ValueError("Text models require an output token limit")
        return self


class TaskSpec(Strict):
    model: str
    capability: Literal["structured-text", "embeddings"]
    prompt: str | None = None
    transport: Literal["plain", "beta", "beta-stream"] = "plain"
    max_output_tokens: int | None = Field(default=None, gt=0, le=32000)
    timeout_seconds: float = Field(gt=0, le=300)

    @model_validator(mode="after")
    def text_needs_prompt(self):
        if self.capability == "structured-text" and (not self.prompt or not self.max_output_tokens):
            raise ValueError("Text tasks require a prompt and output limit")
        if self.capability == "embeddings" and (self.prompt or self.max_output_tokens):
            raise ValueError("Embedding tasks do not use prompts or output tokens")
        return self


class Models(Strict):
    version: Literal[1]
    models: dict[str, ModelSpec]


class Tasks(Strict):
    version: Literal[1]
    tasks: dict[str, TaskSpec]


class Registry(Strict):
    models: dict[str, ModelSpec]
    tasks: dict[str, TaskSpec]

    @model_validator(mode="after")
    def references(self):
        if set(self.tasks) != TASK_NAMES:
            raise ValueError("Registry must map exactly the implemented model-backed tasks")
        for name, task in self.tasks.items():
            if task.model not in self.models:
                raise ValueError(f"Task {name} names an unregistered model")
            validate_binding(name, task, self.models[task.model])
        return self


def validate_binding(name: str, task: TaskSpec, model: ModelSpec) -> None:
    expected = "embeddings" if name == "learning-embeddings" else "structured-text"
    if task.capability != expected:
        raise ConfigurationError(f"Task {name} must use the {expected} capability")
    if task.capability not in model.capabilities:
        raise ConfigurationError(f"Task {name} requires {task.capability}")
    if task.transport == "beta-stream" and "streaming" not in model.capabilities:
        raise ConfigurationError(f"Task {name} requires streaming")
    if task.max_output_tokens and task.max_output_tokens > (model.max_output_tokens or 0):
        raise ConfigurationError(f"Task {name} exceeds the model's output token limit")
    if name == "learning-embeddings" and (
        model.dimensions != 1536
        or (model.provider != "mock" and model.model != "text-embedding-3-small")
    ):
        raise ConfigurationError(
            "The current corpus requires text-embedding-3-small / 1536 dimensions; "
            "rebuild and migrate the index before changing it"
        )


def read_registry(directory: Path = ROOT / "config") -> Registry:
    try:
        models = Models.model_validate_json((directory / "models.json").read_text())
        tasks = Tasks.model_validate_json((directory / "tasks.json").read_text())
        return Registry(models=models.models, tasks=tasks.tasks)
    except ValidationError as error:
        detail = error.errors(include_input=False)[0]["msg"]
        raise ConfigurationError(f"Invalid AI registry: {detail}") from error
    except (OSError, json.JSONDecodeError) as error:
        raise ConfigurationError("Invalid AI registry; check models.json and tasks.json") from error


@lru_cache(maxsize=1)
def registry() -> Registry:
    return read_registry()
