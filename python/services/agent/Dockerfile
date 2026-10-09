# syntax=docker/dockerfile:1
#
# The agent service. Built from the repository root:
#   docker build -f python/services/agent/Dockerfile .
#
# linux/amd64 only. `mediapipe==0.10.35` publishes no linux/arm64 wheel, so on Apple silicon
# this image runs under emulation. compose.yaml pins the platform.
#
# The image runs on its own. compose.yaml also bind-mounts the Python sources over the copies
# made here, so a code change needs only `docker compose restart agent`, not a rebuild.

FROM ghcr.io/astral-sh/uv:0.11.8 AS uv

FROM python:3.12-slim-bookworm

COPY --from=uv /uv /uvx /bin/

# OpenCV's runtime libraries, the same list CI installs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgles2 libegl1 \
  && rm -rf /var/lib/apt/lists/*

# The environment lives outside the source tree, so a bind mount over the sources leaves it
# intact. Workspace members install editable, pointing at /workspace/python.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
  UV_PYTHON_DOWNLOADS=never \
  UV_LINK_MODE=copy \
  UV_COMPILE_BYTECODE=1 \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1

WORKDIR /workspace/python
COPY python/ ./
RUN --mount=type=cache,target=/root/.cache/uv \
  uv sync --frozen --no-dev --package artloupe-agent

# The screening rules are shared with TypeScript, so they live under packages/schemas, and
# the module finds them by walking up to pnpm-workspace.yaml.
COPY pnpm-workspace.yaml /workspace/
COPY packages/schemas/fixtures /workspace/packages/schemas/fixtures

RUN useradd --system --create-home agent

# Deliberately outside the repository. Several settings classes read `.env` relative to the
# working directory, and a container must never pick up a developer's file.
WORKDIR /srv

ENV PATH=/opt/venv/bin:$PATH \
  APP_ENV=docker \
  ARTLOUPE_AGENT_HOST=0.0.0.0 \
  ARTLOUPE_AGENT_PORT=8080

USER agent
EXPOSE 8080
CMD ["python", "-m", "artloupe.agent.service"]
