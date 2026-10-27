"""Decode only escaped JSON blocks produced by the existing typed serializers."""

import json

from artloupe.agent.ai.registry import ConfigurationError


def input_data(task: str, user: str) -> dict:
    try:
        if task == "learning-judge":
            data = json.loads(user)
        else:
            tag = "learning_data" if task == "learning-answer" else "project_data"
            start, end = f"<{tag}>", f"</{tag}>"
            data = json.loads(user.split(start, 1)[1].split(end, 1)[0])
            if not isinstance(data, dict):
                raise ValueError("Input must be an object")
            if task == "director":
                data["offered"] = json.loads(
                    user.split("<offered_tools>", 1)[1].split("</offered_tools>", 1)[0]
                )
        if not isinstance(data, dict):
            raise ValueError("Input must be an object")
        return data
    except (ValueError, IndexError, TypeError) as error:
        raise ConfigurationError(
            f"Task {task} input does not match its serialized contract"
        ) from error
