"""Validate provider authentication without content generation or secret output."""

import httpx

from artloupe.agent.ai.registry import registry
from artloupe.agent.ai.resolver import resolve_task
from artloupe.config import get_anthropic_api_key, get_openai_api_key


async def verify() -> dict:
    selected = {resolve_task(task).model.provider for task in registry().tasks} - {"mock"}
    if not selected:
        return {"passed": True, "mode": "mock", "providers": {}}
    results = {}
    async with httpx.AsyncClient(timeout=20) as client:
        for provider in sorted(selected):
            if provider == "anthropic":
                url = "https://api.anthropic.com/v1/models"
                headers = {"x-api-key": get_anthropic_api_key(), "anthropic-version": "2023-06-01"}
            else:
                url = "https://api.openai.com/v1/models"
                headers = {"Authorization": "Bearer " + get_openai_api_key()}
            try:
                response = await client.get(url, headers=headers)
                results[provider] = {
                    "authenticated": response.status_code == 200,
                    "http_status": response.status_code,
                }
            except httpx.HTTPError:
                results[provider] = {"authenticated": False, "http_status": None}
    return {"passed": all(item["authenticated"] for item in results.values()), "providers": results}
