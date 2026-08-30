"""Verification of Supabase-issued access tokens.

This is the piece every future Art Loupe service depends on: given a bearer token, decide
whether it is genuinely Supabase's, still valid, and addressed to this project.

Two verification modes:

- **Asymmetric (preferred).** Keys come from the project's published JWKS, so a service
  that only *verifies* holds no secret at all. A compromised agent service cannot mint a
  token, because it never had the private key.
- **HS256 shared secret (legacy).** Used when `SUPABASE_JWT_SECRET` is set, which is what a
  local `supabase start` and older hosted projects still hand out. Works, but every
  verifier now holds material that can also *sign*. Migrate to signing keys when you can.

The allowed algorithm is decided by the mode, never read from the token header. Trusting
`alg` is the classic JWT confusion attack: an attacker re-signs a token as HS256 using the
public key as the HMAC secret, and a naive verifier accepts it.
"""

import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt

from .config import AuthSettings

ASYMMETRIC_ALGORITHMS = ("ES256", "RS256", "EdDSA")
SYMMETRIC_ALGORITHMS = ("HS256",)

# Cached JWKS document, keyed by URL: (expires_at_monotonic, key_set).
_jwks_cache: dict[str, tuple[float, jwt.PyJWKSet]] = {}


class InvalidTokenError(Exception):
    """The token is absent, malformed, expired, or not one we issued."""


class KeyResolutionError(RuntimeError):
    """The signing keys could not be fetched. An outage, not a bad token."""


@dataclass(frozen=True)
class VerifiedToken:
    """A token that passed signature, issuer, audience, and expiry checks."""

    subject: str
    """Supabase user id — the value Postgres RLS reads as `auth.uid()`."""

    email: str | None
    role: str
    expires_at: int
    claims: dict[str, Any]


def clear_key_cache() -> None:
    """Drop cached signing keys. For tests and for forcing a rotation pickup."""
    _jwks_cache.clear()


async def _load_key_set(client: httpx.AsyncClient, settings: AuthSettings) -> jwt.PyJWKSet:
    """Fetch the project's JWKS, reusing a cached copy until its TTL lapses."""
    cached = _jwks_cache.get(settings.jwks_url)
    if cached and cached[0] > time.monotonic():
        return cached[1]

    try:
        response = await client.get(settings.jwks_url)
        response.raise_for_status()
        key_set = jwt.PyJWKSet.from_dict(response.json())
    except (httpx.HTTPError, ValueError, jwt.PyJWKError) as exc:
        raise KeyResolutionError("Could not load Supabase signing keys.") from exc

    _jwks_cache[settings.jwks_url] = (
        time.monotonic() + settings.artloupe_jwks_cache_seconds,
        key_set,
    )
    return key_set


def _select_key(key_set: jwt.PyJWKSet, token: str) -> jwt.PyJWK:
    """Find the published key matching the token's `kid`."""
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except jwt.PyJWTError as exc:
        raise InvalidTokenError("Malformed token header.") from exc

    for key in key_set.keys:
        if key.key_id == kid:
            return key

    # A rotation the cache has not picked up looks identical to a forged kid, so this is an
    # invalid token, not an outage. `clear_key_cache()` shortens the window after a rotation.
    raise InvalidTokenError("Token was signed by an unknown key.")


def _decode(token: str, key: Any, algorithms: tuple[str, ...], settings: AuthSettings) -> dict:
    """Decode with every claim check switched on."""
    try:
        return jwt.decode(
            token,
            key=key,
            algorithms=list(algorithms),
            audience=settings.artloupe_jwt_audience,
            issuer=settings.issuer,
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
    except jwt.PyJWTError as exc:
        # The reason is intentionally not propagated to the caller: distinguishing "expired"
        # from "bad signature" for an unauthenticated client is free reconnaissance.
        raise InvalidTokenError("Token failed verification.") from exc


async def verify_access_token(
    token: str,
    client: httpx.AsyncClient,
    settings: AuthSettings,
) -> VerifiedToken:
    """Verify a bearer token and return its principal.

    Raises `InvalidTokenError` if the token is not acceptable, `KeyResolutionError` if we
    could not reach the keys to decide — the caller maps those to 401 and 503 respectively,
    because "we cannot check right now" must never read as "you are not who you say".
    """
    if not token:
        raise InvalidTokenError("No bearer token supplied.")

    if settings.supabase_jwt_secret:
        claims = _decode(token, settings.supabase_jwt_secret, SYMMETRIC_ALGORITHMS, settings)
    else:
        key_set = await _load_key_set(client, settings)
        signing_key = _select_key(key_set, token)
        claims = _decode(token, signing_key.key, ASYMMETRIC_ALGORITHMS, settings)

    app_metadata = claims.get("app_metadata") or {}
    role = app_metadata.get("artloupe_role")

    return VerifiedToken(
        subject=claims["sub"],
        email=claims.get("email"),
        role=role if isinstance(role, str) and role else "artist",
        expires_at=int(claims["exp"]),
        claims=claims,
    )
