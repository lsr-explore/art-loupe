"""One structured model call, as the Visual Analyst, the Studio Planner and the Plan Critic make it.

The Director's call (`artloupe.agent.director`) set the pattern, and this follows it exactly:

- **Structured output, validated here.** The request constrains the reply to the draft model's
  JSON schema, and the reply is validated against the Pydantic model on arrival, so a rejected
  answer still lands on the ledger.
- **Refusals are read before content.** Server-side fallbacks are on in the `"default"` mode, and
  `stop_reason` is checked first.
- **The ledger prices the model that answered**, from `response.model`.
- **Untrusted text travels as escaped JSON data**, never as prompt. The artist's goal is in every
  one of these requests.

The Director keeps its own copy of this sequence for now. Folding it onto this helper changes the
requests its recorded tests assert on, and belongs in its own change.

Each agent reads its model id per call from its own variable, so an eval can switch one agent's
model without touching the others. Which model each agent should use is still open
(`agents.md` §9); every default is the Director's model until that is decided.
"""

import json
import os
from typing import Any

from anthropic import AsyncAnthropic, transform_schema
from pydantic import BaseModel, ValidationError

from artloupe.agent.director import DEFAULT_DIRECTOR_MODEL, FALLBACK_BETA, MAX_TOKENS
from artloupe.metering import record_usage


class AgentCallFailed(RuntimeError):
    """An agent produced no answer the run can use. The run stops, and nothing is invented."""


def agent_model(variable: str) -> str:
    """The model id for one agent, read per call from its own environment variable."""
    return os.environ.get(variable) or DEFAULT_DIRECTOR_MODEL


def escaped_json(value: Any) -> str:
    """JSON in which `<`, `>` and `&` are escaped, so no string inside can close a tag around it."""
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


async def ask_structured[Draft: BaseModel](
    client: AsyncAnthropic,
    *,
    agent: str,
    model: str,
    system: str,
    user: str,
    draft: type[Draft],
    failure: type[AgentCallFailed],
    timeout: float,
) -> Draft:
    """Ask `model` for one `draft`, record what asking cost, and validate what came back.

    `agent` names the agent in the error the run fails with. `timeout` is per request, because a
    plan takes longer to write than a routing decision does.
    """
    response = await client.beta.messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        betas=[FALLBACK_BETA],
        fallbacks="default",
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user}],
        output_config={"format": {"type": "json_schema", "schema": transform_schema(draft)}},
        timeout=timeout,
    )
    usage = response.usage
    record_usage(
        model=response.model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cache_read_tokens=usage.cache_read_input_tokens or 0,
        cache_write_tokens=usage.cache_creation_input_tokens or 0,
    )

    if response.stop_reason == "refusal":
        category = response.stop_details.category if response.stop_details else None
        raise failure(
            f"the {agent}'s model declined the request (category: {category or 'not stated'})"
        )
    text = next((block.text for block in response.content if block.type == "text"), None)
    if response.stop_reason != "end_turn" or text is None:
        raise failure(f"the {agent} returned no answer (stop reason: {response.stop_reason})")
    try:
        return draft.model_validate_json(text)
    except ValidationError as error:
        raise failure(f"the {agent}'s answer did not match its schema") from error
