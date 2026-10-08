"""Where a secret comes from, in each environment.

Tagged `security`: each case is a way a secret reaches the wrong place. It could be read from the
process environment, taken from a keychain on a server, exported to every child process, or spent
in CI. Hermetic: the keychain is faked, the secrets directory is a scratch path, and the
developer's real env files are never read.
"""

import os
import subprocess
import types
from collections.abc import Iterator
from pathlib import Path

import pytest
from pydantic import ValidationError

from artloupe.config import keys
from artloupe.config.keys import (
    PaidCallRefusedInCI,
    SecretUnavailable,
    get_anthropic_api_key,
    get_openai_api_key,
    get_pexels_api_key,
    get_settings,
    require_secret,
    resolve_secret,
)

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="security")

KEYCHAIN_ARGS = ["security", "find-generic-password", "-s", "svc", "-a", "acct", "-w"]

CLEARED = (
    "APP_ENV",
    "CI",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_API_KEY_FILE",
    "OPENAI_API_KEY",
    "OPENAI_API_KEY_FILE",
    "PEXELS_API_KEY",
    "PEXELS_API_KEY_FILE",
    "DATABASE_URL",
    "DATABASE_URL_FILE",
    "ARTLOUPE_KEYCHAIN_SERVICE",
    "ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT",
    "ARTLOUPE_OPENAI_KEYCHAIN_ACCOUNT",
    "ARTLOUPE_PEXELS_KEYCHAIN_ACCOUNT",
)


@pytest.fixture(autouse=True)
def env_files(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[tuple[Path, Path]]:
    """Point the seam at empty scratch files and directories, and clear every variable it reads.

    `CI` is cleared too: GitHub Actions sets it, and the refusal it triggers has its own tests.
    """
    files = (tmp_path / ".env", tmp_path / ".env.local")
    monkeypatch.setattr(keys, "ENV_FILES", files)
    secrets_dir = tmp_path / "run-secrets"
    secrets_dir.mkdir()
    monkeypatch.setattr(keys, "SECRETS_DIR", secrets_dir)
    for name in CLEARED:
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    yield files
    get_settings.cache_clear()


@pytest.fixture
def secrets_dir() -> Path:
    return keys.SECRETS_DIR


@pytest.fixture
def coordinates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARTLOUPE_KEYCHAIN_SERVICE", "svc")
    monkeypatch.setenv("ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT", "acct")


def _keychain_returns(monkeypatch: pytest.MonkeyPatch, stdout: str) -> list[list[str]]:
    """Fake a keychain that answers `stdout`, and record every lookup made against it."""
    calls: list[list[str]] = []

    def fake_run(args: list[str], **_kwargs: object) -> types.SimpleNamespace:
        calls.append(args)
        return types.SimpleNamespace(stdout=stdout)

    monkeypatch.setattr(keys.subprocess, "run", fake_run)
    return calls


def _keychain_raises(monkeypatch: pytest.MonkeyPatch, error: Exception) -> None:
    def fake_run(_args: list[str], **_kwargs: object) -> types.SimpleNamespace:
        raise error

    monkeypatch.setattr(keys.subprocess, "run", fake_run)


# --- APP_ENV ------------------------------------------------------------------------------------


def test_app_env_defaults_to_local() -> None:
    assert get_settings().app_env == "local"


def test_an_unrecognised_app_env_fails_rather_than_falling_back_to_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "prod")
    with pytest.raises(ValidationError):
        get_settings()


def test_an_unrecognised_app_env_fails_even_with_a_mounted_key(
    monkeypatch: pytest.MonkeyPatch, secrets_dir: Path
) -> None:
    """A mounted key must not be a way around the validation."""
    (secrets_dir / "anthropic_api_key").write_text("sk-ant-mounted\n")
    monkeypatch.setenv("APP_ENV", "prod")
    with pytest.raises(ValidationError):
        get_anthropic_api_key()


def test_a_deployed_environment_reads_no_env_file(
    monkeypatch: pytest.MonkeyPatch, env_files: tuple[Path, Path]
) -> None:
    env_files[1].write_text("ARTLOUPE_KEYCHAIN_SERVICE=svc\n")
    monkeypatch.setenv("APP_ENV", "production")
    assert get_settings().artloupe_keychain_service is None


# --- The process environment is never a source ----------------------------------------------


@pytest.mark.parametrize("app_env", ["local", "production"])
def test_an_exported_key_is_never_read(monkeypatch: pytest.MonkeyPatch, app_env: str) -> None:
    monkeypatch.setenv("APP_ENV", app_env)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-exported")
    with pytest.raises(SecretUnavailable):
        get_anthropic_api_key()


def test_a_key_written_into_an_env_file_is_not_read(env_files: tuple[Path, Path]) -> None:
    env_files[1].write_text("ANTHROPIC_API_KEY=sk-ant-in-a-file\n")
    with pytest.raises(SecretUnavailable, match="ARTLOUPE_KEYCHAIN_SERVICE"):
        get_anthropic_api_key()


# --- The keychain ----------------------------------------------------------------------------


@pytest.mark.usefixtures("coordinates")
def test_locally_the_key_is_read_from_the_keychain(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _keychain_returns(monkeypatch, "sk-ant-from-keychain\n")
    assert get_anthropic_api_key() == "sk-ant-from-keychain"
    assert calls == [KEYCHAIN_ARGS]


@pytest.mark.usefixtures("coordinates")
def test_locally_the_keychain_wins_over_a_mounted_file(
    monkeypatch: pytest.MonkeyPatch, secrets_dir: Path
) -> None:
    (secrets_dir / "anthropic_api_key").write_text("sk-ant-mounted\n")
    _keychain_returns(monkeypatch, "sk-ant-from-keychain\n")
    assert get_anthropic_api_key() == "sk-ant-from-keychain"


@pytest.mark.usefixtures("coordinates")
def test_a_keychain_key_is_never_exported(monkeypatch: pytest.MonkeyPatch) -> None:
    _keychain_returns(monkeypatch, "sk-ant-from-keychain\n")
    get_anthropic_api_key()
    assert "ANTHROPIC_API_KEY" not in os.environ


@pytest.mark.parametrize("app_env", ["ci", "production"])
@pytest.mark.usefixtures("coordinates")
def test_a_deployed_environment_never_reads_the_keychain(
    monkeypatch: pytest.MonkeyPatch, secrets_dir: Path, app_env: str
) -> None:
    (secrets_dir / "pexels_api_key").write_text("pexels-mounted\n")
    monkeypatch.setenv("APP_ENV", app_env)
    monkeypatch.setenv("ARTLOUPE_PEXELS_KEYCHAIN_ACCOUNT", "acct")
    calls = _keychain_returns(monkeypatch, "pexels-from-keychain\n")
    assert get_pexels_api_key() == "pexels-mounted"
    assert calls == []


def test_coordinates_come_from_the_env_files_and_env_local_wins(
    monkeypatch: pytest.MonkeyPatch, env_files: tuple[Path, Path]
) -> None:
    dotenv, dotenv_local = env_files
    dotenv.write_text(
        "ARTLOUPE_KEYCHAIN_SERVICE=svc\nARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT=from-dotenv\n"
    )
    dotenv_local.write_text("ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT=acct\n")
    calls = _keychain_returns(monkeypatch, "sk-ant-from-keychain\n")

    get_anthropic_api_key()
    assert calls == [KEYCHAIN_ARGS]
    # Read, not exported: the file's coordinates never reach the process environment either.
    assert "ARTLOUPE_KEYCHAIN_SERVICE" not in os.environ


def test_an_account_without_a_service_is_named(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT", "acct")
    with pytest.raises(SecretUnavailable, match="ARTLOUPE_KEYCHAIN_SERVICE is not set"):
        get_anthropic_api_key()


def test_missing_key_names_every_way_to_provide_it() -> None:
    with pytest.raises(SecretUnavailable) as caught:
        get_anthropic_api_key()
    message = str(caught.value)
    assert "ARTLOUPE_KEYCHAIN_SERVICE" in message
    assert "ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT" in message
    assert "ANTHROPIC_API_KEY_FILE" in message


@pytest.mark.parametrize(
    "error",
    [
        FileNotFoundError("security"),
        subprocess.CalledProcessError(44, KEYCHAIN_ARGS),
        subprocess.TimeoutExpired(KEYCHAIN_ARGS, keys.KEYCHAIN_TIMEOUT_SECONDS),
    ],
    ids=["no-keychain", "item-missing", "locked-and-waiting"],
)
@pytest.mark.usefixtures("coordinates")
def test_a_failed_keychain_lookup_is_named(
    monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    _keychain_raises(monkeypatch, error)
    with pytest.raises(SecretUnavailable, match="keychain lookup .* failed"):
        get_anthropic_api_key()


@pytest.mark.usefixtures("coordinates")
def test_an_empty_keychain_item_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    _keychain_returns(monkeypatch, "\n")
    with pytest.raises(SecretUnavailable, match="is empty"):
        get_anthropic_api_key()


@pytest.mark.usefixtures("coordinates")
def test_the_keychain_lookup_is_bounded_in_time(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def fake_run(_args: list[str], **kwargs: object) -> types.SimpleNamespace:
        seen.update(kwargs)
        return types.SimpleNamespace(stdout="sk-ant-from-keychain\n")

    monkeypatch.setattr(keys.subprocess, "run", fake_run)
    get_anthropic_api_key()
    assert seen["timeout"] == keys.KEYCHAIN_TIMEOUT_SECONDS


def test_openai_reads_its_own_keychain_account(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARTLOUPE_KEYCHAIN_SERVICE", "svc")
    monkeypatch.setenv("ARTLOUPE_OPENAI_KEYCHAIN_ACCOUNT", "acct")
    calls = _keychain_returns(monkeypatch, "synthetic-embedding-key\n")
    assert get_openai_api_key() == "synthetic-embedding-key"
    assert calls == [KEYCHAIN_ARGS]
    assert "OPENAI_API_KEY" not in os.environ


# --- Mounted files ---------------------------------------------------------------------------


@pytest.mark.parametrize("app_env", ["local", "production"])
def test_a_key_mounted_at_the_default_path_is_read(
    monkeypatch: pytest.MonkeyPatch, secrets_dir: Path, app_env: str
) -> None:
    (secrets_dir / "anthropic_api_key").write_text("sk-ant-mounted\n")
    monkeypatch.setenv("APP_ENV", app_env)
    assert get_anthropic_api_key() == "sk-ant-mounted"


def test_the_file_path_is_configurable(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    mounted = tmp_path / "elsewhere" / "anthropic"
    mounted.parent.mkdir()
    mounted.write_text("sk-ant-configured\n")
    monkeypatch.setenv("ANTHROPIC_API_KEY_FILE", str(mounted))
    assert get_anthropic_api_key() == "sk-ant-configured"


def test_a_configured_path_that_is_missing_fails_loudly(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY_FILE", str(tmp_path / "absent"))
    with pytest.raises(SecretUnavailable, match="could not be read"):
        get_anthropic_api_key()


def test_an_empty_secret_file_is_refused(secrets_dir: Path) -> None:
    (secrets_dir / "anthropic_api_key").write_text("\n")
    with pytest.raises(SecretUnavailable, match="is empty"):
        get_anthropic_api_key()


def test_a_mounted_key_is_never_exported(secrets_dir: Path) -> None:
    (secrets_dir / "anthropic_api_key").write_text("sk-ant-mounted\n")
    get_anthropic_api_key()
    assert "ANTHROPIC_API_KEY" not in os.environ


def test_a_rotated_file_is_read_on_the_next_request(secrets_dir: Path) -> None:
    mounted = secrets_dir / "anthropic_api_key"
    mounted.write_text("sk-ant-first\n")
    assert get_anthropic_api_key() == "sk-ant-first"
    mounted.write_text("sk-ant-rotated\n")
    assert get_anthropic_api_key() == "sk-ant-rotated"


# --- Throwaway values outside production ----------------------------------------------------


@pytest.mark.parametrize("app_env", ["local", "ci"])
def test_a_throwaway_value_is_used_outside_production(
    monkeypatch: pytest.MonkeyPatch, app_env: str
) -> None:
    monkeypatch.setenv("APP_ENV", app_env)
    assert resolve_secret("DATABASE_URL", non_production_value="postgresql://local") == (
        "postgresql://local"
    )


def test_production_never_uses_a_throwaway_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    assert resolve_secret("DATABASE_URL", non_production_value="postgresql://local") is None
    with pytest.raises(SecretUnavailable, match="DATABASE_URL_FILE"):
        require_secret("DATABASE_URL", non_production_value="postgresql://local")


def test_a_mounted_file_wins_over_a_throwaway_value(secrets_dir: Path) -> None:
    (secrets_dir / "database_url").write_text("postgresql://mounted\n")
    assert resolve_secret("DATABASE_URL", non_production_value="postgresql://local") == (
        "postgresql://mounted"
    )


def test_an_unconfigured_optional_secret_is_none() -> None:
    assert get_pexels_api_key() is None


# --- CI never spends -----------------------------------------------------------------------


@pytest.mark.parametrize(("variable", "value"), [("CI", "true"), ("CI", "1"), ("APP_ENV", "ci")])
@pytest.mark.parametrize("getter", [get_anthropic_api_key, get_openai_api_key])
def test_paid_keys_are_refused_in_ci_whatever_is_mounted(
    monkeypatch: pytest.MonkeyPatch, secrets_dir: Path, variable: str, value: str, getter
) -> None:
    (secrets_dir / "anthropic_api_key").write_text("sk-ant-mounted\n")
    (secrets_dir / "openai_api_key").write_text("sk-openai-mounted\n")
    monkeypatch.setenv(variable, value)
    with pytest.raises(PaidCallRefusedInCI):
        getter()


def test_the_ci_refusal_is_a_secret_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    """Callers that already turn a missing key into a 503 handle the refusal the same way."""
    monkeypatch.setenv("CI", "true")
    with pytest.raises(SecretUnavailable):
        get_anthropic_api_key()


def test_pexels_is_free_and_not_refused_in_ci(
    monkeypatch: pytest.MonkeyPatch, secrets_dir: Path
) -> None:
    (secrets_dir / "pexels_api_key").write_text("pexels-mounted\n")
    monkeypatch.setenv("CI", "true")
    assert get_pexels_api_key() == "pexels-mounted"


def test_app_env_ci_written_into_an_env_file_also_refuses_paid_keys(
    env_files: tuple[Path, Path], secrets_dir: Path
) -> None:
    """The guard reads the resolved setting, not only the process environment."""
    (secrets_dir / "anthropic_api_key").write_text("sk-ant-mounted\n")
    env_files[1].write_text("APP_ENV=ci\n")
    with pytest.raises(PaidCallRefusedInCI):
        get_anthropic_api_key()
