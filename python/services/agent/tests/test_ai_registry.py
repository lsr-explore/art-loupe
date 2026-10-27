"""Configuration, prompt identity, provider boundaries and complete credential-free runs."""

import json
import socket

import httpx
import pytest
from agent_support import OWNER, PROJECT_ID, FakeArtistApi

from artloupe.agent.ai.__main__ import validate
from artloupe.agent.ai.factory import project_client
from artloupe.agent.ai.mock_learning import mock_index
from artloupe.agent.ai.prompts import load_prompt, read_prompt
from artloupe.agent.ai.registry import ROOT, ConfigurationError, Registry, registry
from artloupe.agent.ai.resolver import resolve_task
from artloupe.agent.graph import build_graph
from artloupe.agent.learning.answering import synthesize
from artloupe.agent.learning.embeddings import build_vectors, embed
from artloupe.agent.learning.models import Question
from artloupe.agent.resources import RunResources
from artloupe.agent.runtime import execute_run
from artloupe.metering import InMemoryMetricsSink, RunGuards

pytestmark = pytest.mark.trace(flow="platform.agent-runtime", category="functionality")

BASELINE_HASHES = {
    "director.v1": "d09efa32a2a2293666d1b5c8fb0f7afe46b3684b562640aea6d361dc6c6a22d5",
    "analyst.v1": "b7daf7d3952e6d0c3c6588af7bb262fc7638704d4f43e362aae056a933aa76b4",
    "planner.v1": "20ffcd9ca4e372b5b682b28d05452a955f4980bb9346dcc57cba21b5fb9623ef",
    "critic.v1": "6ff8c86e0ef36df936cf840526753e3194bee8afcf29177424340f6d3f53e47b",
    "learning-answer.v1": "fd7011aef020949769aef79f5b5e2688332a8927e80601f8c885eddb09ca5143",
    "learning-judge.v1": "84e9866f2143e8cb1ea1ff5e2a745cee0723fc0a8a51d02e5c44a0f4fd543d74",
}


@pytest.mark.parametrize(
    "task", ["director", "analyst", "planner", "critic", "learning-answer", "learning-judge"]
)
def test_defaults_preserve_provider_model_and_prompt(task):
    selected = resolve_task(task)
    assert selected.model.provider == "anthropic"
    assert selected.model.model == "claude-opus-5"
    prompt = load_prompt(selected.settings.prompt)
    assert prompt.spec.sha256 == BASELINE_HASHES[prompt.id]


def test_mock_mode_wins_even_over_invalid_feature_override(monkeypatch):
    monkeypatch.setenv("LLM_MODE", "mock")
    monkeypatch.setenv("AI_MODEL_DIRECTOR", "not-a-model")
    assert all(row["provider"] == "mock" for row in validate(credentials=True))
    assert project_client() is None


def test_feature_override_does_not_change_other_features(monkeypatch):
    monkeypatch.setenv("AI_MODEL_PLANNER", "anthropic-sonnet")
    assert resolve_task("planner").model.model == "claude-sonnet-5"
    assert resolve_task("critic").model_id == "anthropic-current"


def test_mixed_mock_and_live_selection(monkeypatch):
    monkeypatch.setenv("AI_MODEL_DIRECTOR", "mock-text")
    assert resolve_task("director").model.provider == "mock"
    assert resolve_task("analyst").model.provider == "anthropic"


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("LLM_MODE", "typo"),
        ("AI_MODEL_DIRECTOR", "missing"),
        ("AI_MODEL_DIRECTOR", "openai-embeddings"),
        ("AI_MODEL_LEARNING_EMBEDDINGS", "mock-text"),
    ],
)
def test_bad_configuration_is_rejected(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ConfigurationError):
        resolve_task("learning-embeddings" if "EMBEDDINGS" in name else "director")


def test_legacy_selection_warns_and_conflicts_are_errors(monkeypatch):
    monkeypatch.setenv("ARTLOUPE_DIRECTOR_MODEL", "claude-sonnet-5")
    with pytest.warns(DeprecationWarning):
        assert resolve_task("director").model_id == "anthropic-sonnet"
    monkeypatch.setenv("AI_MODEL_DIRECTOR", "anthropic-current")
    with pytest.raises(ConfigurationError, match="Conflicting"):
        resolve_task("director")


def test_registry_rejects_secrets_unregistered_models_and_capability_lies():
    for mutate in [
        lambda d: d["models"]["anthropic-current"].update(api_key="not-allowed"),
        lambda d: d["tasks"]["director"].update(model="missing"),
        lambda d: d["models"]["openai-embeddings"].update(capabilities=["structured-text"]),
        lambda d: d["models"]["openai-embeddings"].update(model="different-embedding-model"),
    ]:
        data = registry().model_dump(mode="json")
        mutate(data)
        with pytest.raises(ValueError):
            Registry.model_validate(data)


def test_manifest_rejects_changed_bytes_path_traversal_and_schema_swap(tmp_path):
    content = json.loads((ROOT / "prompts/manifest.json").read_text())
    target = tmp_path / "manifest.json"
    target.write_text(json.dumps(content))
    spec = content["prompts"]["director.v1"]
    spec["system_file"] = "../outside.txt"
    target.write_text(json.dumps(content))
    with pytest.raises(ConfigurationError, match="inside"):
        read_prompt("director.v1", tmp_path)
    spec["system_file"] = "system.txt"
    (tmp_path / "system.txt").write_text("changed")
    target.write_text(json.dumps(content))
    with pytest.raises(ConfigurationError, match="hash"):
        read_prompt("director.v1", tmp_path)
    spec["output_schema"] = "PlanDraft"
    target.write_text(json.dumps(content))
    with pytest.raises(ConfigurationError, match="schema"):
        read_prompt("director.v1", tmp_path)


async def test_full_project_graph_runs_with_no_keys_or_provider_clients(monkeypatch, detector):
    monkeypatch.setenv("LLM_MODE", "mock")

    def forbidden():
        raise AssertionError("A mock run resolved a real credential")

    monkeypatch.setattr("artloupe.agent.ai.adapters.anthropic.get_anthropic_api_key", forbidden)
    sink = InMemoryMetricsSink()
    result = await execute_run(
        build_graph(),
        {"run_id": "mock-run", "owner": OWNER, "project_id": PROJECT_ID, "node_trail": []},
        run_id="mock-run",
        owner=OWNER,
        guards=RunGuards(40, 2, 60, 250000),
        sink=sink,
        resources=RunResources(api=FakeArtistApi(), director=project_client()),
    )
    assert result.state["plan"]["stages"][0]["title"].startswith("Mock")
    assert result.state["verdicts"][-1]["verdict"] == "READY"
    assert result.state["verdicts"][-1]["summary"].startswith("Mock")
    assert result.cost_usd == 0
    spending = [row for row in result.metrics if row.inference]
    assert len(spending) == 4
    assert all(row.inference[0]["provider"] == "mock" for row in spending)
    assert all(row.inference[0]["actual_model"] == "mock:fixture-v1" for row in spending)
    assert all("prompt_sha256" in row.inference[0] for row in spending)
    encoded = json.dumps([row.model_dump(mode="json") for row in spending])
    assert "sentinel-access-token" not in encoded


async def test_learning_mock_and_embeddings_need_no_corpus_or_network(monkeypatch, tmp_path):
    monkeypatch.setenv("LLM_MODE", "mock")
    index = mock_index()
    answer = await synthesize(
        None,
        Question(question="How should I group values?"),
        index.passages,
        "keyword",
        index.version,
    )
    assert answer.status == "answered"
    assert answer.sources[0].author == "Art Loupe fixtures"
    async with httpx.AsyncClient() as client:
        vectors, tokens = await embed(client, ["same", "same", "other"])
    assert vectors[0] == vectors[1] and vectors[0] != vectors[2]
    assert len(vectors[0]) == 1536 and tokens == 0
    with pytest.raises(ConfigurationError, match="cannot be published"):
        await build_vectors(tmp_path)


def test_external_network_is_blocked():
    with pytest.raises(RuntimeError, match="disabled"):
        socket.getaddrinfo("api.anthropic.com", 443)


async def test_learning_http_mock_needs_no_corpus_client_or_credentials(monkeypatch):
    from types import SimpleNamespace

    from fastapi import FastAPI

    from artloupe.agent.learning import routes
    from artloupe.auth.dependencies import get_http_client, require_token

    monkeypatch.setenv("LLM_MODE", "mock")

    def forbidden():
        raise AssertionError("Mock learning accessed a real corpus")

    monkeypatch.setattr(routes, "configured_index", forbidden)
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[require_token] = lambda: SimpleNamespace(
        subject="mock-learning-test", role="artist"
    )
    async with httpx.AsyncClient() as upstream:
        app.dependency_overrides[get_http_client] = lambda: upstream
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post("/learning/ask", json={"question": "What is value?"})
    assert response.status_code == 200
    assert response.json()["status"] == "answered"
    assert response.json()["sources"][0]["author"] == "Art Loupe fixtures"
    assert response.json()["usage"]["input_tokens"] == 0


def test_missing_live_credentials_fail_without_fallback(monkeypatch):
    from artloupe.agent.ai.adapters import anthropic
    from artloupe.config import SecretUnavailable

    anthropic.shared_client.cache_clear()

    def missing():
        raise SecretUnavailable("Test provider key is not available")

    monkeypatch.setattr(anthropic, "get_anthropic_api_key", missing)
    with pytest.raises(SecretUnavailable, match="not available"):
        project_client()


async def test_schema_and_input_mismatch_fail_before_provider_creation():
    from artloupe.agent.ai.factory import generate
    from artloupe.agent.director import DirectorDecision
    from artloupe.agent.planner import PlanDraft

    with pytest.raises(ConfigurationError, match="incompatible"):
        await generate("director", client=None, schema=PlanDraft, user="unused")
    with pytest.raises(ConfigurationError, match="input"):
        await generate(
            "director",
            client=None,
            schema=DirectorDecision,
            user='<offered_tools>[]</offered_tools><project_data>{"extra":true}</project_data>',
        )


async def test_mock_provider_verification_does_not_claim_live_authentication(monkeypatch):
    from artloupe.agent.learning.verification import verify

    monkeypatch.setenv("LLM_MODE", "mock")
    assert await verify() == {"passed": True, "mode": "mock", "providers": {}}


def test_text_factory_cannot_initialize_a_client_for_embeddings():
    from artloupe.agent.ai.factory import task_client

    with pytest.raises(ConfigurationError, match="embedding provider"):
        task_client("learning-embeddings")


def test_bad_selector_errors_do_not_echo_configuration_values(monkeypatch):
    monkeypatch.setenv("AI_MODEL_DIRECTOR", "sensitive-value-entered-in-wrong-setting")
    with pytest.raises(ConfigurationError) as caught:
        resolve_task("director")
    assert "sensitive-value" not in str(caught.value)
    assert "AI_MODEL_DIRECTOR" in str(caught.value)
