"""LangGraph orchestration for the Art Loupe studio director.

The one HTTP surface the Python side exposes. Per ADR 0002 the call path is
browser → Next.js route handler → this service; the browser never reaches it directly, and
Python never handles a credential — only a forwarded Supabase access token it verifies
through `artloupe-auth`.

The graph loads a project as the artist, gates on a face, surveys the photograph, routes, and
runs the selected deterministic tools (`docs/design/routing-plan.md`). The routing node is a
labelled deterministic stand-in until PR 12b brings the model-driven Studio Director.
"""

from artloupe.agent.graph import build_graph
from artloupe.agent.state import RunState

__all__ = ["RunState", "build_graph"]
