"""Versioned prompt resources. File hashes pin exact bytes, not a template engine's output."""

import hashlib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field

from artloupe.agent.ai.registry import ROOT, TASK_NAMES, ConfigurationError, Strict

SCHEMAS = {
    "director": "DirectorDecision",
    "analyst": "AnalystDraft",
    "planner": "PlanDraft",
    "critic": "CriticDraft",
    "learning-answer": "Draft",
    "learning-judge": "Judgment",
}
INPUTS = {
    "director": {"intent", "gate", "survey", "offered"},
    "analyst": {"intent", "catalog"},
    "planner": {"intent", "findings", "set_aside", "lessons"},
    "critic": {"intent", "plan", "findings", "lessons", "defects_already_found"},
    "learning-answer": {"question", "passages"},
    "learning-judge": {"question", "medium", "expected_status", "rubric", "answer"},
}


class PromptSpec(Strict):
    task: str
    version: int = Field(gt=0)
    system_file: str
    input_contract: str
    inputs: frozenset[str]
    output_schema: str
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class Manifest(Strict):
    version: Literal[1]
    prompts: dict[str, PromptSpec]


@dataclass(frozen=True)
class Prompt:
    id: str
    spec: PromptSpec
    system: str

    def check(self, task: str, schema: str) -> None:
        if self.spec.task != task or self.spec.output_schema != schema:
            raise ConfigurationError(
                f"Prompt {self.id} is incompatible with task {task} / schema {schema}"
            )


def read_prompt(identity: str, directory: Path = ROOT / "prompts") -> Prompt:
    try:
        manifest = Manifest.model_validate_json((directory / "manifest.json").read_text())
        spec = manifest.prompts[identity]
        if (
            spec.task not in TASK_NAMES
            or SCHEMAS.get(spec.task) != spec.output_schema
            or INPUTS.get(spec.task) != spec.inputs
        ):
            raise ConfigurationError(f"Prompt {identity} has an unknown schema or input contract")
        serializer = {"learning-answer": "learning"}.get(spec.task, spec.task)
        if spec.input_contract != f"{serializer}-input.v1":
            raise ConfigurationError(f"Prompt {identity} has an unknown input serializer")
        relative = Path(spec.system_file)
        target = (directory / relative).resolve()
        if relative.is_absolute() or not target.is_relative_to(directory.resolve()):
            raise ConfigurationError("Prompt files must stay inside the packaged prompt directory")
        data = target.read_bytes()
        if hashlib.sha256(data).hexdigest() != spec.sha256:
            raise ConfigurationError(f"Prompt {identity} content does not match its manifest hash")
        return Prompt(identity, spec, data.decode("utf-8"))
    except (OSError, KeyError, ValueError) as error:
        if isinstance(error, ConfigurationError):
            raise
        raise ConfigurationError(
            f"Cannot load prompt {identity}; check its manifest and resource"
        ) from error


@lru_cache(maxsize=16)
def load_prompt(identity: str) -> Prompt:
    return read_prompt(identity)
