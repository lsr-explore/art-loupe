"""Runtime configuration for token verification.

Read from the environment at first use, never at import, so the module can be imported
in a build step or a test collection that has no secrets — the same rule
`packages/auth/src/options.ts` follows on the TypeScript side.

Third-party variables keep their vendor names (`SUPABASE_URL`); Art Loupe's own settings
carry the `ARTLOUPE_` prefix, matching `python/.env.example`.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AuthSettings(BaseSettings):
    """Environment-backed settings for verifying forwarded access tokens."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    supabase_url: str = Field(description="Supabase project URL, e.g. http://127.0.0.1:54321")
    supabase_anon_key: str = Field(
        description=(
            "Public anon key. Verification needs no secret, but the JWKS endpoint is served "
            "behind it. NEVER the service-role key — nothing in this library needs one."
        )
    )

    supabase_jwt_secret: str | None = Field(
        default=None,
        description=(
            "Legacy HS256 signing secret. When set, tokens are verified symmetrically — "
            "which also means this process holds material that can SIGN tokens, not just "
            "verify them. Leave unset to use the published JWKS instead, which is the "
            "safer mode. A local `supabase start` still issues HS256, so local dev sets it."
        ),
    )

    artloupe_jwt_audience: str = Field(
        default="authenticated",
        description="Expected `aud` claim. Supabase issues 'authenticated' for signed-in users.",
    )
    artloupe_jwks_cache_seconds: int = Field(
        default=600,
        description="How long a fetched JWKS document is reused before refetching.",
    )
    artloupe_auth_timeout_seconds: float = Field(
        default=10.0,
        description="Timeout for fetching the JWKS document from Supabase.",
    )

    @property
    def gotrue_base_url(self) -> str:
        """Base URL of the GoTrue endpoints, without a trailing slash."""
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def jwks_url(self) -> str:
        """Where the project publishes its JWT signing keys."""
        return f"{self.gotrue_base_url}/.well-known/jwks.json"

    @property
    def issuer(self) -> str:
        """Expected `iss` claim on tokens this project issues."""
        return self.gotrue_base_url


@lru_cache(maxsize=1)
def get_settings() -> AuthSettings:
    """Process-wide settings, resolved once.

    Cached rather than module-level so import stays side-effect free; tests clear it with
    `get_settings.cache_clear()`.
    """
    return AuthSettings()  # type: ignore[call-arg]  # values come from the environment
