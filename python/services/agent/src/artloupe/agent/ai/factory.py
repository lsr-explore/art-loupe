"""Resolve a task and inject a capability adapter; importing this module never reads a key."""

import logging

from pydantic import BaseModel

from artloupe.agent.ai.contracts import Completion, TextProvider, TextRequest
from artloupe.agent.ai.prompts import SCHEMAS, load_prompt
from artloupe.agent.ai.registry import ConfigurationError
from artloupe.agent.ai.resolver import resolve_task
from artloupe.metering import active_span

logger = logging.getLogger(__name__)
PROJECT_TASKS = ("director", "analyst", "planner", "critic")


def project_client() -> TextProvider | None:
    """Preflight only live project features; mocks never construct a credential-bearing SDK."""
    selections = [resolve_task(task) for task in PROJECT_TASKS]
    for selected in selections:
        load_prompt(selected.settings.prompt).check(selected.task, SCHEMAS[selected.task])
    if all(selection.model.provider == "mock" for selection in selections):
        return None
    from artloupe.agent.ai.adapters.anthropic import AnthropicProvider

    return AnthropicProvider()


def task_client(task: str) -> TextProvider | None:
    selected = resolve_task(task)
    if selected.settings.capability != "structured-text":
        raise ConfigurationError(f"Task {task} requires an embedding provider, not a text client")
    load_prompt(selected.settings.prompt).check(task, SCHEMAS[task])
    if selected.model.provider == "mock":
        return None
    from artloupe.agent.ai.adapters.anthropic import AnthropicProvider

    return AnthropicProvider()


async def generate(
    task: str, *, client: TextProvider | None, schema: type[BaseModel], user: str
) -> Completion:
    selected = resolve_task(task)
    if selected.settings.capability != "structured-text":
        raise ConfigurationError(f"Task {task} is not structured text")
    prompt = load_prompt(selected.settings.prompt)
    prompt.check(task, schema.__name__)
    from artloupe.agent.ai.inputs import input_data

    if set(input_data(task, user)) != set(prompt.spec.inputs):
        raise ConfigurationError(f"Task {task} input does not match its prompt manifest")
    trace = dict(
        task=task,
        provider=selected.model.provider,
        model_id=selected.model_id,
        requested_model=selected.model.model,
        prompt_id=prompt.id,
        prompt_version=prompt.spec.version,
        prompt_sha256=prompt.spec.sha256,
    )
    span = active_span()
    if span is not None:
        span.inference.append(trace)
    logger.info("AI task resolved", extra=trace)
    if selected.model.provider == "mock":
        from artloupe.agent.ai.adapters.mock import MockTextProvider

        adapter = MockTextProvider()
    elif client is not None and hasattr(client, "generate"):
        if client.provider != selected.model.provider:
            raise ConfigurationError(f"Injected provider is incompatible with task {task}")
        adapter = client
    else:
        # Compatibility bridge for existing SDK transport-injection tests.
        from artloupe.agent.ai.adapters.anthropic import AnthropicProvider

        adapter = AnthropicProvider(client)
    result = await adapter.generate(TextRequest(selected, prompt.system, user, schema))
    trace["actual_model"] = result.model
    logger.info("AI task completed", extra=trace)
    return result
