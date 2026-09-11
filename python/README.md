# Python workspace

The Python half of Art Loupe, managed as a single [uv](https://docs.astral.sh/uv/)
workspace. The TypeScript apps live in `../apps` and `../packages`; everything Python
lives here, organized by role.

```text
python/
├─ pyproject.toml   # workspace root (virtual): members, ruff + pytest config
├─ conftest.py      # pytest `trace` marker, validated against flows.json
├─ uv.lock          # single lockfile for all members
├─ services/
│  └─ agent/        # the LangGraph agent behind FastAPI — one Cloud Run service
└─ libs/
   ├─ auth/         # Supabase access-token verification and the FastAPI guards on it
   ├─ schemas/      # Pydantic mirror of @artloupe/schemas, held to parity by a fixture
   ├─ persistence/  # LangGraph checkpointing over Postgres, in its own schema
   ├─ metering/     # per-node token, latency and cost metering, and run guards
   └─ image-tools/  # deterministic CV — the workspace's one cv2 provider
```

Packages use the `artloupe.*` namespace (PEP 420) to mirror the TypeScript
`@artloupe/*` scope: `artloupe-schemas` imported as `from artloupe.schemas import ...`.

## Commands

Always invoke through `uv run` — a bare `python` or `pytest` picks up a different
interpreter.

```sh
uv sync --all-packages      # install the workspace
uv run poe check            # ruff format --check + ruff check + pytest
uv run poe test             # pytest
uv run poe lint             # ruff check
uv run poe format           # ruff format
```

From the monorepo root these are reachable as `uv run --directory python poe <task>`.

## Test traceability

Every test module declares the flow it verifies and in what respect. `conftest.py`
validates the value against `../docs/test-traceability-reports/flows.json` at collection
time, so an unknown flow is a hard error rather than a silently dropped row.

```python
pytestmark = pytest.mark.trace(flow="analysis.geometry", category="functionality")
```
