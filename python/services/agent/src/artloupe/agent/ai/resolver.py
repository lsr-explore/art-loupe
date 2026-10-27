"""Resolve registered IDs per call; configuration never silently selects another provider."""

import os
import warnings
from dataclasses import dataclass

from artloupe.agent.ai.registry import (
    ConfigurationError,
    ModelSpec,
    Registry,
    TaskSpec,
    registry,
    validate_binding,
)

LEGACY = {
    "director": "ARTLOUPE_DIRECTOR_MODEL",
    "analyst": "ARTLOUPE_ANALYST_MODEL",
    "planner": "ARTLOUPE_PLANNER_MODEL",
    "critic": "ARTLOUPE_CRITIC_MODEL",
    "learning-answer": "ARTLOUPE_LEARNING_MODEL",
    "learning-judge": "ARTLOUPE_LEARNING_JUDGE_MODEL",
}


@dataclass(frozen=True)
class Selection:
    task: str
    model_id: str
    model: ModelSpec
    settings: TaskSpec


def resolve_task(task: str, *, config: Registry | None = None) -> Selection:
    config = config or registry()
    if task not in config.tasks:
        raise ConfigurationError(f"Unknown AI task: {task}")
    settings = config.tasks[task]
    mode = os.environ.get("LLM_MODE", "live")
    if mode not in {"mock", "live"}:
        raise ConfigurationError("LLM_MODE must be mock or live")
    variable = "AI_MODEL_" + task.upper().replace("-", "_")
    if mode == "mock":
        model_id = "mock-embeddings" if settings.capability == "embeddings" else "mock-text"
    else:
        override = os.environ.get(variable)
        legacy = os.environ.get(LEGACY.get(task, ""))
        model_id = override or settings.model
        if legacy:
            matches = [
                key
                for key, value in config.models.items()
                if value.provider == "anthropic" and value.model == legacy
            ]
            if len(matches) != 1:
                raise ConfigurationError(
                    f"{LEGACY[task]} must name a uniquely registered model; migrate to {variable}"
                )
            if override and override != matches[0]:
                raise ConfigurationError(f"Conflicting {variable} and {LEGACY[task]}")
            model_id = override or matches[0]
            warnings.warn(
                f"{LEGACY[task]} is deprecated; use {variable} with a registered ID",
                DeprecationWarning,
                stacklevel=2,
            )
    if model_id not in config.models:
        raise ConfigurationError(f"{variable} must reference a registered model ID")
    model = config.models[model_id]
    validate_binding(task, settings, model)
    return Selection(task, model_id, model, settings)
