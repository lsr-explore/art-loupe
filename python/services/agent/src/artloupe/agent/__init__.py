"""Art Loupe's Python agent service. Public graph exports are loaded only when requested."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from artloupe.agent.graph import build_graph
    from artloupe.agent.state import RunState

__all__ = ["RunState", "build_graph"]


def __getattr__(name):
    if name == "build_graph":
        from artloupe.agent.graph import build_graph

        return build_graph
    if name == "RunState":
        from artloupe.agent.state import RunState

        return RunState
    raise AttributeError(name)
