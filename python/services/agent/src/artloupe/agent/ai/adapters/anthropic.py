"""Preserve the existing Anthropic wire requests, streaming and refusal fallback behavior."""

from functools import lru_cache

from anthropic import APIError, AsyncAnthropic, transform_schema

from artloupe.agent.ai.contracts import Completion, ProviderUnavailable, TextRequest, TokenUsage
from artloupe.config import get_anthropic_api_key

FALLBACK_BETA = "server-side-fallback-2026-07-01"


@lru_cache(maxsize=1)
def shared_client() -> AsyncAnthropic:
    return AsyncAnthropic(api_key=get_anthropic_api_key(), timeout=45.0, max_retries=1)


async def close_client() -> None:
    if shared_client.cache_info().currsize:
        await shared_client().close()
        shared_client.cache_clear()


class AnthropicProvider:
    provider = "anthropic"

    def __init__(self, client=None):
        self.client = client if client is not None else shared_client()

    async def generate(self, request: TextRequest) -> Completion:
        try:
            return await self._generate(request)
        except APIError as error:
            raise ProviderUnavailable("The configured text provider is unavailable") from error

    async def _generate(self, request: TextRequest) -> Completion:
        settings = request.selection.settings
        arguments = dict(
            model=request.selection.model.model,
            max_tokens=settings.max_output_tokens,
            system=request.system,
            messages=[{"role": "user", "content": request.user}],
            output_config={
                "format": {"type": "json_schema", "schema": transform_schema(request.schema)}
            },
        )
        if settings.transport in {"beta", "beta-stream"}:
            arguments.update(
                betas=[FALLBACK_BETA],
                fallbacks="default",
                system=[
                    {"type": "text", "text": request.system, "cache_control": {"type": "ephemeral"}}
                ],
            )
        if settings.transport == "beta-stream":
            async with self.client.beta.messages.stream(
                **arguments, timeout=settings.timeout_seconds
            ) as stream:
                response = await stream.get_final_message()
        elif settings.transport == "beta":
            response = await self.client.beta.messages.create(
                **arguments, timeout=settings.timeout_seconds
            )
        else:
            response = await self.client.messages.create(
                **arguments, timeout=settings.timeout_seconds
            )
        usage = response.usage
        details = getattr(response, "stop_details", None)
        return Completion(
            text=next((part.text for part in response.content if part.type == "text"), None),
            model=response.model,
            finish_reason=response.stop_reason,
            refusal_category=getattr(details, "category", None),
            usage=TokenUsage(
                usage.input_tokens,
                usage.output_tokens,
                usage.cache_read_input_tokens or 0,
                usage.cache_creation_input_tokens or 0,
            ),
        )
