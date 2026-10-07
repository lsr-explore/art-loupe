"""Validate provider authentication without content generation or secret output."""

import httpx

from artloupe.config import get_anthropic_api_key, get_openai_api_key


async def verify() -> dict:
    results = {}
    async with httpx.AsyncClient(timeout=20) as client:
        for provider, url, headers in (
            (
                "anthropic",
                "https://api.anthropic.com/v1/models",
                {
                    "x-api-key": get_anthropic_api_key(),
                    "anthropic-version": "2023-06-01",
                },
            ),
            (
                "openai",
                "https://api.openai.com/v1/models",
                {
                    "Authorization": "Bearer " + get_openai_api_key(),
                },
            ),
        ):
            try:
                response = await client.get(url, headers=headers)
                results[provider] = {
                    "authenticated": response.status_code == 200,
                    "http_status": response.status_code,
                }
            except httpx.HTTPError:
                results[provider] = {"authenticated": False, "http_status": None}
    return {"passed": all(item["authenticated"] for item in results.values()), "providers": results}
