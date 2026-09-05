"""Art Loupe's database layer: checkpoints, and the tables the artist's work lives in.

The library that makes an interrupted run resumable. When a geometry tool's confidence falls
below threshold the graph stops and waits for the artist (FR-402); the checkpoint written here
is what lets the run continue afterwards — minutes later, and in a different process than the
one that paused it.

`InMemorySaver` is the default so tests and CI stay hermetic. It is the wrong answer anywhere
a restart can happen, which is why `ARTLOUPE_PERSISTENCE=postgres` exists.

Alongside that, `tables` names the `public` tables holding projects and their originals. The
two live together because they are the same question asked twice — what may reach which rows —
and the answers differ: checkpoints are kept off the API surface entirely, while project rows
must be on it and are confined by row policies instead. The tests that hold those answers to
account are in this package's suite.
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
from artloupe.persistence.tables import (
    PROJECTS_TABLE,
    REFERENCE_IMAGE_BUCKET,
    SOURCE_IMAGES_TABLE,
)

__all__ = [
    "CHECKPOINT_SCHEMA",
    "PROJECTS_TABLE",
    "REFERENCE_IMAGE_BUCKET",
    "SOURCE_IMAGES_TABLE",
    "PersistenceMode",
    "PersistenceSettings",
    "connection_kwargs",
    "get_async_checkpointer",
    "get_settings",
    "reset_checkpointer",
]
