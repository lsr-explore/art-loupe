"""Supabase, reached as the signed-in artist.

The agent holds no credential of its own. No app runtime holds `service_role`, and the direct
`DATABASE_URL` connection the checkpointer uses connects as `postgres`, which bypasses RLS. So
every read of an artist's project and every write of a cached result goes through Supabase's HTTP
APIs presenting the artist's own bearer token, and row-level security decides what it may reach.

The request shapes mirror the studio's, so there is one way to talk to Supabase rather than two:

- PostgREST requires an `apikey` header even when the bearer token is the real credential. The
  anon key fills it, as `apps/studio/src/lib/intake/ingest-upload.ts` does.
- Storage takes the bearer alone, as `apps/studio/src/lib/storage/upload-reference-image.ts` does.
- The append-only cache table is written with `resolution=ignore-duplicates` and an explicit
  `on_conflict`, as `screening_detections` is. Two runs racing on one recipe both succeed, and
  the loser keeps the winner's row.

"Not visible" and "does not exist" are one answer here. RLS makes another artist's project look
absent, and reporting the two differently would tell a caller which project ids are real.
"""

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import httpx
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from artloupe.persistence.tables import (
    PROJECTS_TABLE,
    REFERENCE_IMAGE_BUCKET,
    SOURCE_IMAGES_TABLE,
    TOOL_RESULTS_TABLE,
)

# The unique key `tool_results_one_row_per_recipe` enforces, named for PostgREST's `on_conflict`.
_TOOL_RESULT_RECIPE = "project_id,tool,tool_version,parameters_digest"


class ArtistApiSettings(BaseSettings):
    """Where Supabase is, and the public key its API gateway asks for.

    There is deliberately no field for a service-role key. Nothing this client does needs one, and
    a field that could hold one is a field someone will eventually fill.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    supabase_url: str = Field(description="Supabase project URL, e.g. http://127.0.0.1:54321")
    supabase_anon_key: str = Field(
        description="Public anon key, sent as PostgREST's required `apikey` header. Not a secret."
    )
    artloupe_artist_api_timeout_seconds: float = Field(
        default=60.0,
        gt=0,
        description="Per-request timeout. Generous because an original can be 25 MB (FR-101).",
    )


@lru_cache(maxsize=1)
def get_artist_api_settings() -> ArtistApiSettings:
    """Process-wide settings, resolved at first use rather than at import."""
    return ArtistApiSettings()  # type: ignore[call-arg]  # values come from the environment


class ArtistApiError(RuntimeError):
    """Supabase refused or failed a call made as the artist."""


class ProjectNotFound(ArtistApiError):
    """No project with this id is visible to this artist: absent, or somebody else's."""


class CredentialRejected(ArtistApiError):
    """Supabase rejected the artist's token itself (HTTP 401).

    Distinct from every other refusal because the remedy is the caller's: refresh the token and
    retry. A run checks the token's expiry before it starts, so this is the rarer path — clock
    skew between this service and Supabase, or a signing key rotated mid-run. Reporting it as an
    upstream fault would invite a retry with the same unusable token.

    A 403 is not this. PostgREST answers a row-policy refusal with 403, and a fresh token would
    be refused exactly the same way.
    """


@dataclass(frozen=True)
class SourceImage:
    """The project's immutable original, as `source_images` records it (FR-105)."""

    checksum: str
    storage_key: str
    mime_type: str
    width_px: int
    height_px: int


@dataclass(frozen=True)
class ArtistProject:
    """A project the artist can see. `intent` is the raw `ProjectIntent` JSON, unvalidated."""

    project_id: str
    intent: dict[str, Any] | None
    # `None` until the artist has uploaded a photograph.
    source: SourceImage | None


@dataclass(frozen=True)
class ToolResultKey:
    """The FR-305 recipe a cached result is stored under, scoped to one project."""

    project_id: str
    source_checksum: str
    tool: str
    tool_version: str
    parameters_digest: str


def parameters_digest(parameters: Mapping[str, Any]) -> str:
    """SHA-256 of `parameters` as canonical JSON: sorted keys, no whitespace, no NaN.

    Canonical so two equal parameter sets always produce one key, whatever order a model happened
    to dump its fields in. NaN is refused rather than encoded, because JSON has no NaN and a
    digest of Python's non-standard spelling would not reproduce anywhere else.
    """
    canonical = json.dumps(parameters, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _rest_name(qualified: str) -> str:
    """`public.projects` → `projects`. PostgREST addresses tables in the exposed schema bare."""
    schema, _, table = qualified.partition(".")
    if schema != "public" or not table:
        raise ValueError(f"expected a table in the API-exposed `public` schema, got {qualified!r}")
    return table


def _raise_for(response: httpx.Response, doing: str) -> None:
    """Raise if Supabase refused. The status is reported; the body is not.

    A PostgREST error body can quote the policy or constraint that fired, which is detail about
    the schema a caller has no need of.
    """
    if response.is_success:
        return
    if response.status_code == 401:
        raise CredentialRejected(
            f"Supabase rejected the artist's token while trying to {doing}: HTTP 401"
        )
    raise ArtistApiError(f"Supabase refused to {doing} as the artist: HTTP {response.status_code}")


class ArtistApi:
    """Supabase's REST and Storage APIs, presenting one artist's token.

    Holds the token for the length of one run and no longer. It is excluded from `repr`, and it
    must never be put in graph state: a checkpoint would keep it after the token expired.
    """

    def __init__(
        self,
        access_token: str,
        *,
        client: httpx.AsyncClient,
        settings: ArtistApiSettings | None = None,
    ) -> None:
        resolved = settings or get_artist_api_settings()
        base = resolved.supabase_url.rstrip("/")
        self._token = access_token
        self._anon_key = resolved.supabase_anon_key
        self._client = client
        self._timeout = resolved.artloupe_artist_api_timeout_seconds
        self._rest = f"{base}/rest/v1"
        self._storage = f"{base}/storage/v1"

    def __repr__(self) -> str:
        return f"ArtistApi(rest={self._rest!r})"

    def _rest_headers(self) -> dict[str, str]:
        return {"apikey": self._anon_key, "authorization": f"Bearer {self._token}"}

    def _storage_headers(self) -> dict[str, str]:
        return {"authorization": f"Bearer {self._token}"}

    async def _select(self, qualified: str, params: dict[str, str], doing: str) -> list[dict]:
        response = await self._client.get(
            f"{self._rest}/{_rest_name(qualified)}",
            params=params,
            headers=self._rest_headers(),
            timeout=self._timeout,
        )
        _raise_for(response, doing)
        rows = response.json()
        if not isinstance(rows, list):
            raise ArtistApiError(f"expected rows when trying to {doing}, got {type(rows).__name__}")
        return rows

    async def load_project(self, project_id: str) -> ArtistProject:
        """The project and its original, or `ProjectNotFound` if the artist cannot see it.

        Two requests rather than one embedded select, for the same reason the studio's deletion
        path uses two: each answers one question, and a missing original is then plainly distinct
        from a missing project.
        """
        projects = await self._select(
            PROJECTS_TABLE, {"id": f"eq.{project_id}", "select": "id,intent"}, "read the project"
        )
        if not projects:
            raise ProjectNotFound(f"no project {project_id} is visible to this artist")

        originals = await self._select(
            SOURCE_IMAGES_TABLE,
            {
                "project_id": f"eq.{project_id}",
                "select": "checksum,storage_key,mime_type,width_px,height_px",
            },
            "read the project's original",
        )
        return ArtistProject(
            project_id=projects[0]["id"],
            intent=projects[0]["intent"],
            source=SourceImage(**originals[0]) if originals else None,
        )

    async def download_original(self, source: SourceImage) -> bytes:
        """The original's bytes, read from the private bucket as the artist."""
        response = await self._client.get(
            f"{self._storage}/object/{REFERENCE_IMAGE_BUCKET}/{source.storage_key}",
            headers=self._storage_headers(),
            timeout=self._timeout,
        )
        _raise_for(response, "download the original")
        return response.content

    async def find_tool_result(self, key: ToolResultKey) -> dict[str, Any] | None:
        """The cached result for this recipe, or `None` on a miss.

        Filters on the checksum as well as the recipe. The insert policy already ties every row
        to its project's original, so this cannot change the answer today; it keeps a lookup
        honest if that policy is ever loosened.
        """
        rows = await self._select(
            TOOL_RESULTS_TABLE,
            {
                "project_id": f"eq.{key.project_id}",
                "source_checksum": f"eq.{key.source_checksum}",
                "tool": f"eq.{key.tool}",
                "tool_version": f"eq.{key.tool_version}",
                "parameters_digest": f"eq.{key.parameters_digest}",
                "select": "result",
            },
            "read a cached tool result",
        )
        return rows[0]["result"] if rows else None

    async def store_tool_result(self, key: ToolResultKey, result: Mapping[str, Any]) -> None:
        """Cache `result` under `key`. A row already there for the recipe is kept, not replaced."""
        response = await self._client.post(
            f"{self._rest}/{_rest_name(TOOL_RESULTS_TABLE)}",
            params={"on_conflict": _TOOL_RESULT_RECIPE},
            headers={
                **self._rest_headers(),
                "prefer": "resolution=ignore-duplicates,return=minimal",
            },
            json={
                "project_id": key.project_id,
                "source_checksum": key.source_checksum,
                "tool": key.tool,
                "tool_version": key.tool_version,
                "parameters_digest": key.parameters_digest,
                "result": dict(result),
            },
            timeout=self._timeout,
        )
        _raise_for(response, "store a tool result")
