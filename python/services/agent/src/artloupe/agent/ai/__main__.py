"""Configuration-only diagnostics: no inference calls and no credential output."""

import argparse
import json
import sys

from artloupe.agent.ai.prompts import SCHEMAS, load_prompt
from artloupe.agent.ai.registry import ConfigurationError, registry
from artloupe.agent.ai.resolver import resolve_task
from artloupe.config import SecretUnavailable, get_anthropic_api_key, get_openai_api_key


def validate(*, credentials: bool = False) -> list[dict]:
    rows = []
    checked = set()
    for task in registry().tasks:
        selected = resolve_task(task)
        prompt = load_prompt(selected.settings.prompt) if selected.settings.prompt else None
        if prompt:
            prompt.check(task, SCHEMAS[task])
        if credentials and selected.model.provider not in checked:
            if selected.model.provider == "anthropic":
                get_anthropic_api_key()
            elif selected.model.provider == "openai":
                get_openai_api_key()
            checked.add(selected.model.provider)
        rows.append(
            dict(
                task=task,
                provider=selected.model.provider,
                model_id=selected.model_id,
                model=selected.model.model,
                capability=selected.settings.capability,
                prompt=prompt.id if prompt else None,
                prompt_sha256=prompt.spec.sha256 if prompt else None,
            )
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["validate"])
    parser.add_argument("--check-credentials", action="store_true")
    args = parser.parse_args()
    try:
        rows = validate(credentials=args.check_credentials)
    except (ConfigurationError, SecretUnavailable) as error:
        print(f"AI configuration failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"credential_check": args.check_credentials, "tasks": rows}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
