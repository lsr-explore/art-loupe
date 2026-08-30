# Python workspace

The Python half of Art Loupe, managed as a single [uv](https://docs.astral.sh/uv/)
workspace. The TypeScript apps live in `../apps` and `../packages`; everything Python
lives here, organized by role.

**Currently an empty scaffold.** The toolchain is wired and enforced in CI; the agent
and ML code is authored from here.

```text
python/
├─ pyproject.toml   # workspace root (virtual): members, ruff + pytest config
├─ conftest.py      # pytest `trace` marker, validated against flows.json
├─ uv.lock          # single lockfile for all members
├─ services/        # deployable apps — one per Cloud Run service
└─ libs/            # shared libraries
```

Packages will use the `artloupe.*` namespace (PEP 420) to mirror the TypeScript
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
pytestmark = pytest.mark.trace(flow="critique.formal-analysis", category="functionality")
```
