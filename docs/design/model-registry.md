# AI model registry and prompt manifests

AI inference stays in the Python service. The Next.js applications continue to relay the artist's
authenticated requests, and no provider SDK or credential enters a browser bundle.

## Organization

All paths below are relative to `python/services/agent/src/artloupe/agent/ai/`.

| Resource | Responsibility |
| --- | --- |
| `config/models.json` | Registered provider model IDs, capabilities, credential references and endpoints |
| `config/tasks.json` | Task-to-model and task-to-prompt mappings, token limits, timeouts and transport |
| `registry.py`, `resolver.py` | Runtime validation and configuration precedence |
| `contracts.py`, `factory.py` | Small capability interfaces, dependency injection and request provenance |
| `adapters/` | Anthropic text, OpenAI embeddings and deterministic mocks |
| `prompts/manifest.json` | Versioned prompt identity, schema and input contract, file path and SHA-256 |
| `prompts/<task>/v1/system.txt` | Exact original system prompt bytes |
| `fixtures/` | Task-specific development responses, shipped without importing tests |

The implemented tasks are `director`, `analyst`, `planner`, `critic`, `learning-answer`,
`learning-judge` and `learning-embeddings`. Face detection remains local MediaPipe. Grayscale,
value maps, contours, outlines and perspective remain deterministic image tools.

Existing agent modules stay where they are. A later agent-colocation refactor can move them
without also changing model resolution. The shared provider client still travels under the
compatibility name `RunResources.director`; it is now a provider protocol, not an Anthropic type.
Existing SDK transport-injection tests are accepted through an adapter compatibility bridge.

## Configuration

JSON is validated by Pydantic using the dependencies already installed. A provider cannot claim
a capability its adapter does not implement. Registries contain no secrets. Current adapters
accept only their first-party endpoints; custom/local endpoints belong with future adapters.

Selection is resolved per call, in this order:

1. `LLM_MODE=mock` forces every supported model task to a deterministic mock, including embeddings.
2. A task's `AI_MODEL_*` selector references a registered model ID.
3. The task mapping supplies the normal model selection.

There is no global fallback across incompatible capabilities or providers. Unset `LLM_MODE`
means `live`, preserving existing development and production behavior. Unknown modes, IDs,
capabilities, schemas and conflicting overrides fail rather than selecting a paid alternative.
The existing Anthropic refusal fallback remains explicitly enabled for the project agents;
its actual response model is still used for token accounting.

Examples, exported in the shell rather than stored as secrets:

```sh
# All model features are deterministic and need no provider credentials.
export LLM_MODE=mock
uv run --directory python python -m artloupe.agent.ai validate --check-credentials

# Normal task mappings, with only the Planner on another registered model.
export LLM_MODE=live
export AI_MODEL_PLANNER=anthropic-sonnet

# One feature can be mocked while others retain their normal mappings.
export AI_MODEL_LEARNING_ANSWER=mock-text
```

Selectors are `AI_MODEL_DIRECTOR`, `AI_MODEL_ANALYST`, `AI_MODEL_PLANNER`, `AI_MODEL_CRITIC`,
`AI_MODEL_LEARNING_ANSWER`, `AI_MODEL_LEARNING_JUDGE` and `AI_MODEL_LEARNING_EMBEDDINGS`.
Multiple registered entries can use one provider. Register and validate a new model before
selecting it; a raw vendor model name in an `AI_MODEL_*` variable is not a registered ID.

Legacy `ARTLOUPE_DIRECTOR_MODEL`, `ARTLOUPE_ANALYST_MODEL`, `ARTLOUPE_PLANNER_MODEL`,
`ARTLOUPE_CRITIC_MODEL`, `ARTLOUPE_LEARNING_MODEL` and `ARTLOUPE_LEARNING_JUDGE_MODEL` remain
compatibility aliases. Their raw Anthropic model names must resolve uniquely in the registry.
They emit deprecation warnings; conflicting old and new selections are errors.

Credentials still use `artloupe.config`: keychain on a local developer machine, mounted secret
files elsewhere. API keys are never registry values or raw environment values. CI refuses
paid provider keys even if files or keychain coordinates were accidentally supplied.

The Docker configuration forwards model selectors. `LLM_MODE=mock ./scripts/docker/up.sh`
skips Anthropic/OpenAI keychain lookup and does not require provider keys. Supabase and normal
application authentication are still required. Pexels is a separate optional inspiration source.

## Prompt management

The extracted system prompts preserve their original bytes, including whitespace. Existing
Python functions keep responsibility for serializing typed input into escaped JSON data blocks.
There is no general-purpose string substitution engine and no evaluation of schema names.

Each manifest entry declares a task, version, relative file path, input serializer contract,
exact input names, response schema identifier and SHA-256. The loader rejects traversal outside
the packaged prompt folder, mismatched hashes, unknown input contracts and incompatible schemas.
The factory checks the serialized input keys and the domain response schema before inference.

To change a prompt intentionally, add a new versioned file and manifest entry, compute its hash,
and update the task mapping. Keep the previous version in Git and in the package while it is
needed for reproducibility. A changed file with an unchanged manifest hash is a configuration
error. Restart the process after changing packaged registry or prompt resources.

## Mocks, retrieval and embeddings

Mock responses are task-aware fixtures, visibly labelled in routing, plans and review summaries.
The mock Planner adapts its time box and references to the supplied data. Domain validation,
routing completeness, plan checks and run guards still execute normally.

Mock learning uses a packaged development passage with explicit fixture provenance. It does
not need a downloaded book corpus, provider client or embedding index. It does not evaluate
live answer quality; the mock evaluation judge deliberately returns negative quality flags.

Mock embeddings are deterministic, but they must never be compared with vectors from a real
model. A real learning answer with mocked embeddings uses keyword retrieval. Publishing mock
embeddings into a corpus is rejected.

The current corpus and pgvector schema require `text-embedding-3-small` at 1,536 dimensions.
The resolver rejects another embedding model or dimensionality. Supporting a different model
requires re-embedding, index identity checks and an explicit storage migration, even if its
vector dimensions match the old model.

## Diagnostics and provenance

`uv run --directory python python -m artloupe.agent.ai validate` validates selected models and
prompt contracts without looking up credentials or making provider calls. Add
`--check-credentials` to check only the selected live providers' secret availability. Neither
command performs inference, prints credentials or validates remote account access.

Each call logs task, provider, registered model ID, requested model and prompt identity/hash.
The actual response model is added to the call's node provenance. The additive migration
`20261027190000_add_inference_provenance.sql` stores this list in `run_node_metrics.inference`.
Embedding provenance includes its model and dimension count, with no prompt fields.
No raw prompts, user input, artwork, vectors or credentials are stored in this metadata.
Existing public run response contracts stay unchanged. Unknown live-model pricing stays
unpriced; mock calls explicitly cost zero.

Apply the migration through `pnpm exec supabase migration up --local` before running the
Postgres metrics sink. Existing records receive an empty provenance list.

## Tests and provider extensions

CI selects mock mode and validates credential-free configuration. Agent wire-contract tests
isolate shell selectors and use recorded SDK transports; runtime tests explicitly select
mock mode and run the complete graph. External Python socket connections and DNS are blocked
in agent tests, with local integration services allowed. Live tests require the existing
explicit `ARTLOUPE_LIVE_TESTS=1` opt-in and remain refused in CI.

Tests cover resolution precedence, mixed models/mocks, legacy conflicts, prompt identity,
manifest tampering, invalid capabilities, embedding-index protection and provenance. Registry,
prompt and fixture resources are included in the installed wheel and Docker image.

Hugging Face hosted/local inference, Ollama and OpenAI text adapters are deferred. Text generation,
embeddings and future detection each need their own typed capability contract. A future detection
adapter should return labels, boxes, scores and coordinate conventions, not a text-completion
response. No new SDK or orchestration framework was added by this refactor.
