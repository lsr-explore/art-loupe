"""Provider-neutral structured response validation for the Analyst, Planner and Critic.

Request settings and prompt selection live in ai/config and ai/prompts. This helper preserves
usage-before-validation, refusal handling, and each domain's own failure type.
"""

import json
from typing import Any

from pydantic import BaseModel, ValidationError

from artloupe.agent.ai.contracts import TextProvider
from artloupe.agent.ai.factory import generate
from artloupe.metering import record_usage


class AgentCallFailed(RuntimeError):
    """An agent produced no answer the run can use. The run stops, and nothing is invented."""


def escaped_json(value: Any) -> str:
    """JSON in which `<`, `>` and `&` are escaped, so no string inside can close a tag around it."""
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


async def ask_structured[Draft: BaseModel](
    client: TextProvider | None,
    *,
    agent: str,
    task: str,
    user: str,
    draft: type[Draft],
    failure: type[AgentCallFailed],
) -> Draft:
    """Resolve the task, record its usage and validate its domain draft."""
    response = await generate(task, client=client, schema=draft, user=user)
    usage = response.usage
    record_usage(
        model=response.model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cache_read_tokens=usage.cache_read_input_tokens or 0,
        cache_write_tokens=usage.cache_creation_input_tokens or 0,
    )

    if response.finish_reason == "refusal":
        category = response.refusal_category
        raise failure(
            f"the {agent}'s model declined the request (category: {category or 'not stated'})"
        )
    text = response.text
    if response.finish_reason != "end_turn" or text is None:
        raise failure(f"the {agent} returned no answer (stop reason: {response.finish_reason})")
    try:
        return draft.model_validate_json(text)
    except ValidationError as error:
        raise failure(f"the {agent}'s answer did not match its schema") from error
