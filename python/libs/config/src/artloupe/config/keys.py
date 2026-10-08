"""Where a secret comes from — the one module that knows.

Ported from veloce-trace's `veloce-config`, key resolution only (`docs/design/routing-plan.md`
§6). Veloce's AI cache, LangSmith tracing, hard-stop mode and pre-LLM scrubbing were left behind
on purpose.

A secret is anything that grants access: a provider key, or a database URL with a password in it.
Every secret resolves the same way, first match wins:

1. **The macOS keychain**, only when `APP_ENV` is `local` and the secret's keychain account is
   configured. The item lives at `ARTLOUPE_KEYCHAIN_SERVICE` and the secret's own account
   variable. Those coordinates may come from `python/.env` or `python/.env.local`, and
   `.env.local` wins where the files disagree.
2. **A mounted file.** The path is `<NAME>_FILE` when that is set, and `/run/secrets/<name>`
   otherwise. This is how Docker, Kubernetes and Cloud Run deliver secrets.
3. **A throwaway value, outside production only.** Some secrets have local defaults that protect
   nothing, such as the local Supabase `postgres:postgres` URL. Their callers may pass that value
   in, and it is used in `local` and `ci`. A provider key has no such value.

Nothing else. **A secret is never read from the process environment**, so it is never visible to
every child process, and **a key is never exported**: it is returned to the caller, which hands
it straight to the client.

**Paid provider keys are refused in CI.** A key request under `CI=true` or `APP_ENV=ci` fails
before any lookup, whatever is mounted. Every paid call resolves its key here, so this one check
covers the test suite, the learning CLI and the service alike.
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

# Where a secret file is looked for when its `<NAME>_FILE` variable is unset. Docker Compose
# mounts its secrets here; other platforms name the path through `<NAME>_FILE` instead.
SECRETS_DIR = Path("/run/secrets")

# A locked keychain can raise a password dialog, and `security` waits on it. The bound turns a
# hang into a named error well inside the run's wall-clock ceiling.
KEYCHAIN_TIMEOUT_SECONDS = 30.0


class SecretUnavailable(RuntimeError):
    """No secret could be resolved. The message names what to set, and never carries a value."""


class PaidCallRefusedInCI(SecretUnavailable):
    """A paid provider key was requested in CI, where nothing may spend tokens."""


class SecretSettings(BaseSettings):
    """Where to look for a secret. Coordinates only: no field here ever holds a secret."""

    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    app_env: AppEnv = Field(
        default="local",
        description=(
            "`local` may read the keychain. `ci` and `production` read only mounted files. Any "
            "other value fails validation rather than falling back to `local`, where a typo "
            "would send a server looking for a keychain."
        ),
    )
    artloupe_keychain_service: str | None = Field(
        default=None,
        description="The keychain service shared by every secret, e.g. `art-loupe`.",
    )
    artloupe_anthropic_keychain_account: str | None = Field(
        default=None,
        description="The account of the Anthropic key's keychain item, under that service.",
    )
    artloupe_openai_keychain_account: str | None = None
    artloupe_pexels_keychain_account: str | None = None


@lru_cache(maxsize=1)
def get_settings() -> SecretSettings:
    """Process-wide settings, resolved once. Tests clear it with `get_settings.cache_clear()`.

    The environment is decided from the process environment *before* any file is read. A platform
    that names itself `ci` or `production` reads no file at all, so a stray `.env` cannot pull it
    back to the keychain.
    """
    declared = os.environ.get("APP_ENV", "local")
    return SecretSettings(_env_file=ENV_FILES if declared == "local" else None)


def running_in_ci() -> bool:
    """True when the runner says so, or when `APP_ENV` resolves to `ci` from any source.

    GitHub Actions sets `CI=true`. `APP_ENV` is checked through the settings rather than the
    process environment alone, so `APP_ENV=ci` written into `python/.env` counts too.
    """
    flagged = os.environ.get("CI", "").strip().lower() in {"1", "true", "yes"}
    return flagged or get_settings().app_env == "ci"


def resolve_secret(
    name: str,
    *,
    keychain_account: str | None = None,
    non_production_value: str | None = None,
) -> str | None:
    """Resolve one secret by the order in the module docstring, or `None` when none is set.

    `None` lets an optional feature switch itself off. A secret that is configured but unusable
    (a missing file, an empty keychain item) raises instead, because that is a mistake to fix
    rather than a feature to skip.

    The value is read on every call, never cached here. A caller that builds a long-lived client
    or connection pool from it keeps the first value, so a rotated file reaches the Director
    client and the database pools at the next restart.
    """
    settings = get_settings()

    if settings.app_env == "local" and keychain_account:
        service = settings.artloupe_keychain_service
        if not service:
            raise SecretUnavailable(
                f"A keychain account is configured for {name}, but ARTLOUPE_KEYCHAIN_SERVICE is "
                "not set (see python/.env.example)."
            )
        return _read_keychain(service=service, account=keychain_account, name=name)

    from_file = _read_secret_file(name)
    if from_file is not None:
        return from_file

    if settings.app_env != "production" and non_production_value:
        return non_production_value
    return None


def require_secret(name: str, *, non_production_value: str | None = None) -> str:
    """Like `resolve_secret`, for a secret the caller cannot run without."""
    value = resolve_secret(name, non_production_value=non_production_value)
    if value is None:
        raise SecretUnavailable(
            f"{name} is not available. Mount it as {SECRETS_DIR / name.lower()}, or point "
            f"{name}_FILE at a file that holds it."
        )
    return value


def get_anthropic_api_key() -> str:
    """The Anthropic API key, for the client's `api_key` argument and nowhere else."""
    return _paid_provider_key(
        "ANTHROPIC_API_KEY",
        account=get_settings().artloupe_anthropic_keychain_account,
        account_var="ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT",
    )


def get_openai_api_key() -> str:
    """The OpenAI embedding key, for the client's `api_key` argument and nowhere else."""
    return _paid_provider_key(
        "OPENAI_API_KEY",
        account=get_settings().artloupe_openai_keychain_account,
        account_var="ARTLOUPE_OPENAI_KEYCHAIN_ACCOUNT",
    )


def get_pexels_api_key() -> str | None:
    """The Pexels key, or `None` when Pexels is not configured and the provider is off.

    Pexels is free, so unlike the model providers it is not refused in CI. CI binds no key, so
    the provider is off there anyway.
    """
    return resolve_secret(
        "PEXELS_API_KEY", keychain_account=get_settings().artloupe_pexels_keychain_account
    )


def _paid_provider_key(name: str, *, account: str | None, account_var: str) -> str:
    # Validate APP_ENV before the CI check, so a mistyped value fails the same way everywhere.
    get_settings()
    if running_in_ci():
        raise PaidCallRefusedInCI(
            f"{name} was requested in CI. Paid provider calls never run in CI; fake the client "
            "at the transport instead (see agent_support.RecordedDirector)."
        )
    key = resolve_secret(name, keychain_account=account)
    if key is None:
        raise SecretUnavailable(
            f"No {name} is available. On a developer machine, set ARTLOUPE_KEYCHAIN_SERVICE and "
            f"{account_var} (see python/.env.example) so it is read from the keychain. "
            f"Elsewhere, mount it as {SECRETS_DIR / name.lower()} or point {name}_FILE at it."
        )
    return key


def _read_secret_file(name: str) -> str | None:
    """Read `<NAME>_FILE`, else the default mount. `None` only when neither is configured."""
    file_var = f"{name}_FILE"
    configured = os.environ.get(file_var)
    target = Path(configured) if configured else SECRETS_DIR / name.lower()
    if not configured and not target.is_file():
        return None

    try:
        value = target.read_text(encoding="utf-8").strip()
    except OSError as error:
        raise SecretUnavailable(
            f"The secret file for {name} at {target} could not be read. Check the mount, or "
            f"{file_var}."
        ) from error
    if not value:
        raise SecretUnavailable(f"The secret file for {name} at {target} is empty.")
    return value


def _read_keychain(*, service: str, account: str, name: str) -> str:
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
            f"The keychain lookup for {name} (service {service!r}, account {account!r}) failed: "
            "there is no macOS keychain, it is locked, or the item does not exist. Off a "
            f"developer machine, unset the account variable and mount {name} as a file."
        ) from error

    key = result.stdout.strip()
    if not key:
        raise SecretUnavailable(
            f"The keychain item for {name} (service {service!r}, account {account!r}) is empty."
        )
    return key
