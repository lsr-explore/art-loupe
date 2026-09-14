"""Where the Anthropic key comes from, in each environment.

Tagged `security`: each case is a way a key reaches the wrong place. It could be read from a file
it should never be in, taken from a keychain on a server, or exported to every child process.
Hermetic: the keychain is faked, and the developer's real env files are never read.
"""

import os
import subprocess
import types
from collections.abc import Iterator
from pathlib import Path

import pytest
from pydantic import ValidationError

from artloupe.config import keys
from artloupe.config.keys import SecretUnavailable, get_anthropic_api_key, get_settings

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="security")

KEYCHAIN_ARGS = ["security", "find-generic-password", "-s", "svc", "-a", "acct", "-w"]


@pytest.fixture(autouse=True)
def env_files(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[tuple[Path, Path]]:
    """Point the seam at empty scratch files, and clear every variable it reads."""
    files = (tmp_path / ".env", tmp_path / ".env.local")
    monkeypatch.setattr(keys, "ENV_FILES", files)
    for name in (
        "APP_ENV",
        "ANTHROPIC_API_KEY",
        "ARTLOUPE_KEYCHAIN_SERVICE",
        "ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT",
    ):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    yield files
    get_settings.cache_clear()


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


def test_app_env_defaults_to_local() -> None:
    assert get_settings().app_env == "local"


def test_an_unrecognised_app_env_fails_rather_than_falling_back_to_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "prod")
    with pytest.raises(ValidationError):
        get_settings()


@pytest.mark.parametrize("app_env", ["ci", "production"])
def test_a_deployed_environment_needs_the_key_in_its_environment(
    monkeypatch: pytest.MonkeyPatch, app_env: str
) -> None:
    monkeypatch.setenv("APP_ENV", app_env)
    with pytest.raises(SecretUnavailable, match="ANTHROPIC_API_KEY"):
        get_anthropic_api_key()

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-deployed")
    assert get_anthropic_api_key() == "sk-ant-deployed"


@pytest.mark.parametrize("app_env", ["ci", "production"])
@pytest.mark.usefixtures("coordinates")
def test_a_deployed_environment_never_reads_the_keychain(
    monkeypatch: pytest.MonkeyPatch, app_env: str
) -> None:
    monkeypatch.setenv("APP_ENV", app_env)
    calls = _keychain_returns(monkeypatch, "sk-ant-from-keychain\n")
    with pytest.raises(SecretUnavailable):
        get_anthropic_api_key()
    assert calls == []


def test_a_deployed_environment_reads_no_env_file(
    monkeypatch: pytest.MonkeyPatch, env_files: tuple[Path, Path]
) -> None:
    env_files[1].write_text("ARTLOUPE_KEYCHAIN_SERVICE=svc\n")
    monkeypatch.setenv("APP_ENV", "production")
    assert get_settings().artloupe_keychain_service is None


@pytest.mark.usefixtures("coordinates")
def test_locally_an_exported_key_wins_over_the_keychain(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-exported")
    calls = _keychain_returns(monkeypatch, "sk-ant-from-keychain\n")
    assert get_anthropic_api_key() == "sk-ant-exported"
    assert calls == []


@pytest.mark.usefixtures("coordinates")
def test_locally_the_key_is_read_from_the_keychain(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _keychain_returns(monkeypatch, "sk-ant-from-keychain\n")
    assert get_anthropic_api_key() == "sk-ant-from-keychain"
    assert calls == [KEYCHAIN_ARGS]


@pytest.mark.usefixtures("coordinates")
def test_a_keychain_key_is_never_exported(monkeypatch: pytest.MonkeyPatch) -> None:
    _keychain_returns(monkeypatch, "sk-ant-from-keychain\n")
    get_anthropic_api_key()
    assert "ANTHROPIC_API_KEY" not in os.environ


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


def test_a_key_written_into_an_env_file_is_not_read(env_files: tuple[Path, Path]) -> None:
    env_files[1].write_text("ANTHROPIC_API_KEY=sk-ant-in-a-file\n")
    with pytest.raises(SecretUnavailable, match="ARTLOUPE_KEYCHAIN_SERVICE"):
        get_anthropic_api_key()


def test_missing_coordinates_name_both_variables() -> None:
    with pytest.raises(SecretUnavailable) as caught:
        get_anthropic_api_key()
    assert "ARTLOUPE_KEYCHAIN_SERVICE" in str(caught.value)
    assert "ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT" in str(caught.value)


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
