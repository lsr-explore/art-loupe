"""LangGraph orchestration for the Art Loupe studio director.

The one HTTP surface the Python side exposes. Per ADR 0002 the call path is
browser → Next.js route handler → this service; the browser never reaches it directly, and
Python never handles a credential — only a forwarded Supabase access token it verifies
through `artloupe-auth`.

Currently a skeleton: one graph node, one authenticated endpoint, one health check. It exists
so the transport, the auth guard, and a compiled graph are proven together before any of them
carries real work.
"""

from artloupe.agent.graph import build_graph, seed
from artloupe.agent.state import RunState

__all__ = ["RunState", "build_graph", "seed"]
