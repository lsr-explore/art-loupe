"""The Studio Director's model call: what the model is shown, and what it must send back.

`artloupe.agent.routing` owns the decision and its checks. This module owns the one conversation
with the model. Provider selection and request construction live in `artloupe.agent.ai`.

**What the model sees** (routing-plan §3): the artist's intent, the face gate's result, and the
survey's first-pass figures. Each survey figure carries the FR-305 metadata of the tool that
measured it. The gate's figures come from the face detector, which keeps no FR-305 record, and
the prompt says so. The Director "never interprets pixels itself" (`agents.md` §4.1), so the
request carries no image.

**The goal is untrusted** (FR-106). It was screened at ingest. Here it travels as data inside a JSON
block whose angle brackets are escaped, so no string in it can close the tag around it, and the
system prompt says it is never an instruction.

**Structured output, validated here.** The request constrains the reply to `DirectorDecision`'s
JSON schema, and the reply is validated against the Pydantic model on arrival. The SDK's
`messages.parse` would do both, but it raises inside the call when validation fails, and the
response's `usage` is lost with it. The schema carries `minLength` only as a description, so such a
failure can happen. Validating here keeps a rejected answer on the ledger.

**Refusals are read before content.** Server-side fallbacks are on, in the `"default"` mode
(routing-plan §10, question 1): a request Opus 5's classifiers decline is re-run on a substitute
inside the same call. The substitute can refuse too, so `stop_reason` is checked first.

**The ledger prices the model that answered.** `response.model` names it, and top-level `usage`
covers only the attempt that produced the returned message. An attempt declined before any output
is not billed. If a non-streaming attempt is declined partway through its output, the response
omits that partial, and this module cannot see whether it was billed.
"""

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from artloupe.agent.ai.adapters.anthropic import FALLBACK_BETA as FALLBACK_BETA
from artloupe.agent.ai.adapters.anthropic import close_client
from artloupe.agent.ai.contracts import TextProvider
from artloupe.agent.ai.factory import generate, project_client
from artloupe.agent.ai.prompts import load_prompt
from artloupe.agent.ai.registry import registry
from artloupe.agent.ai.resolver import resolve_task
from artloupe.metering import record_usage
from artloupe.schemas import ToolDeclination, ToolSelection

DEFAULT_DIRECTOR_MODEL = registry().models[registry().tasks["director"].model].model

# The `"default"` fallback mode's beta. The array form uses a different header, and pairing either
# header with the other form is a 400.

# Room for adaptive thinking as well as the decision, which is itself well under a thousand tokens.
MAX_TOKENS = registry().tasks["director"].max_output_tokens

# Two attempts at 45 s fit inside the run's 300 s wall clock, with room left for the other
# agents' calls. The wall-clock guard stays the backstop.
REQUEST_TIMEOUT_SECONDS = 45.0
MAX_RETRIES = 1

SYSTEM_PROMPT = load_prompt("director.v1").system


class RoutingFailed(RuntimeError):
    """The Director produced no decision the run can use. The run stops, and nothing is invented."""


class DirectorRefused(RoutingFailed):
    """The model and any fallback declined the request. `category` is the API's, when given."""

    def __init__(self, category: str | None) -> None:
        self.category = category
        super().__init__(
            f"the Director's model declined the request (category: {category or 'not stated'})"
        )


class DirectorDecision(BaseModel):
    """The model's answer: its half of the manifest, and the rationale the artist reads."""

    model_config = ConfigDict(extra="forbid")

    selected: list[ToolSelection]
    declined: list[ToolDeclination]
    rationale: str = Field(min_length=1)


def director_model() -> str:
    """The Director's model id. Read per call, so an eval can switch it without a code change."""
    return resolve_task("director").model.model


def director_client() -> TextProvider | None:
    """Compatibility name for the project's preflighted provider client."""
    return project_client()


async def close_director_client() -> None:
    await close_client()


def project_message(
    *,
    intent: dict[str, Any],
    gate: dict[str, Any],
    survey: dict[str, Any],
    offered: list[str],
) -> str:
    """The user turn: the offered tools, then everything else as one escaped JSON block."""
    data = {"intent": intent, "gate": gate, "survey": survey}
    return (
        f"<offered_tools>{_escaped_json(offered)}</offered_tools>\n"
        f"<project_data>\n{_escaped_json(data)}\n</project_data>"
    )


def _escaped_json(value: Any) -> str:
    """JSON in which `<`, `>` and `&` are escaped, so no string inside can close a tag around it.

    The result is still valid JSON, because `\\u003c` decodes back to `<`. The artist's goal is the
    string this exists for: a goal containing `</project_data>` would otherwise end the data block
    and carry on as if it were the prompt.
    """
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


async def ask_director(
    client: TextProvider | None,
    *,
    intent: dict[str, Any],
    gate: dict[str, Any],
    survey: dict[str, Any],
    offered: list[str],
) -> DirectorDecision:
    """Ask the model for its half of the routing decision, and record what asking cost."""
    response = await generate(
        "director",
        client=client,
        schema=DirectorDecision,
        user=project_message(intent=intent, gate=gate, survey=survey, offered=offered),
    )
    usage = response.usage
    record_usage(
        model=response.model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cache_read_tokens=usage.cache_read_input_tokens or 0,
        cache_write_tokens=usage.cache_creation_input_tokens or 0,
    )

    if response.finish_reason == "refusal":
        raise DirectorRefused(response.refusal_category)
    text = response.text
    if response.finish_reason != "end_turn" or text is None:
        raise RoutingFailed(
            f"the Director returned no decision (stop reason: {response.finish_reason})"
        )
    try:
        return DirectorDecision.model_validate_json(text)
    except ValidationError as error:
        raise RoutingFailed("the Director's decision did not match its schema") from error
