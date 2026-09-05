"""LangGraph checkpointing for Art Loupe.

The library that makes an interrupted run resumable. When a geometry tool's confidence falls
below threshold the graph stops and waits for the artist (FR-402); the checkpoint written here
is what lets the run continue afterwards — minutes later, and in a different process than the
one that paused it.

`InMemorySaver` is the default so tests and CI stay hermetic. It is the wrong answer anywhere
a restart can happen, which is why `ARTLOUPE_PERSISTENCE=postgres` exists.
"""

from artloupe.persistence.checkpointer import (
    connection_kwargs,
    get_async_checkpointer,
    reset_checkpointer,
)
from artloupe.persistence.config import (
    CHECKPOINT_SCHEMA,
    PersistenceMode,
    PersistenceSettings,
    get_settings,
)

__all__ = [
    "CHECKPOINT_SCHEMA",
    "PersistenceMode",
    "PersistenceSettings",
    "connection_kwargs",
    "get_async_checkpointer",
    "get_settings",
    "reset_checkpointer",
]
