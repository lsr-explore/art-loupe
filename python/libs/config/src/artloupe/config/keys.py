"""Where a provider key comes from — the one module that knows.

Ported from veloce-trace's `veloce-config`, key resolution only (`docs/design/routing-plan.md`
§6). Veloce's AI cache, LangSmith tracing, hard-stop mode and pre-LLM scrubbing were left behind
on purpose.

`APP_ENV` names the environment, and the environment decides everything else:

- `local`, the default, is a developer machine. The Anthropic key is read from the macOS
  keychain item at `ARTLOUPE_KEYCHAIN_SERVICE` and `ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT`. Those
  two coordinates may come from `python/.env` or `python/.env.local`, and `.env.local` wins
  where the files disagree. An `ANTHROPIC_API_KEY` set in the process environment overrides the
  keychain. That is the escape hatch for a host without one.
- `ci` and `production` read the key from `ANTHROPIC_API_KEY` only. No env file is read, the
  keychain is never touched, and a missing key fails fast.

**A key is never read from a file.** The env files hold coordinates, not values, so a key pasted
into one is ignored rather than quietly used.

**A key is never exported.** It is returned to the caller, which hands it straight to the client.
A key written to `os.environ` would be visible to every child process.
"""

import os
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

AppEnv = Literal["local", "ci", "production"]

# keys.py -> config -> artloupe -> src -> config (the lib) -> libs -> python
PYTHON_ROOT = Path(__file__).resolve().parents[5]

# Anchored to the workspace rather than the working directory, so the same files are read whether
# the process starts in `python/` or at the repository root. Later files win.
ENV_FILES: tuple[Path, ...] = (PYTHON_ROOT / ".env", PYTHON_ROOT / ".env.local")

# A locked keychain can raise a password dialog, and `security` waits on it. The bound turns a
# hang into a named error well inside the run's wall-clock ceiling.
KEYCHAIN_TIMEOUT_SECONDS = 30.0


class SecretUnavailable(RuntimeError):
    """No key could be resolved. The message names what to set, and never carries a value."""


class SecretSettings(BaseSettings):
    """Where to look for a key. Coordinates only: no field here ever holds a key."""

    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    app_env: AppEnv = Field(
        default="local",
        description=(
            "`local` reads the keychain. `ci` and `production` read only the process "
            "environment. Any other value fails validation rather than falling back to `local`, "
            "where a typo would send a server looking for a keychain."
        ),
    )
    artloupe_keychain_service: str | None = Field(
        default=None,
        description="The keychain service shared by every provider key, e.g. `art-loupe`.",
    )
    artloupe_anthropic_keychain_account: str | None = Field(
        default=None,
        description="The account of the Anthropic key's keychain item, under that service.",
    )


@lru_cache(maxsize=1)
def get_settings() -> SecretSettings:
    """Process-wide settings, resolved once. Tests clear it with `get_settings.cache_clear()`.

    The environment is decided from the process environment *before* any file is read. A platform
    that names itself `ci` or `production` reads no file at all, so a stray `.env` cannot pull it
    back to the keychain.
    """
    declared = os.environ.get("APP_ENV", "local")
    return SecretSettings(_env_file=ENV_FILES if declared == "local" else None)


def get_anthropic_api_key() -> str:
    """The Anthropic API key, for the client's `api_key` argument and nowhere else.

    The settings are validated first, even when an exported key would win. A mistyped `APP_ENV`
    therefore fails whether or not a key is exported, and the strictness has no exception.
    """
    settings = get_settings()
    explicit = os.environ.get("ANTHROPIC_API_KEY")
    if explicit:
        return explicit

    if settings.app_env != "local":
        raise SecretUnavailable(
            f"ANTHROPIC_API_KEY is not set. With APP_ENV={settings.app_env} it must come from the "
            "platform environment, and the keychain is never read."
        )

    service = settings.artloupe_keychain_service
    account = settings.artloupe_anthropic_keychain_account
    if not service or not account:
        raise SecretUnavailable(
            "No Anthropic key is available. Set ARTLOUPE_KEYCHAIN_SERVICE and "
            "ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT (see python/.env.example) so the key can be "
            "read from the keychain, or set ANTHROPIC_API_KEY in the environment."
        )
    return _read_keychain(service=service, account=account, override_var="ANTHROPIC_API_KEY")


def _read_keychain(*, service: str, account: str, override_var: str) -> str:
    """Read one generic-password item. The value goes back to the caller and nowhere else."""
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
            capture_output=True,
            text=True,
            check=True,
            timeout=KEYCHAIN_TIMEOUT_SECONDS,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise SecretUnavailable(
            f"The keychain lookup for service {service!r}, account {account!r} failed: there is "
            f"no macOS keychain, it is locked, or the item does not exist. Set {override_var} in "
            "the environment to bypass the keychain."
        ) from error

    key = result.stdout.strip()
    if not key:
        raise SecretUnavailable(
            f"The keychain item for service {service!r}, account {account!r} is empty."
        )
    return key
