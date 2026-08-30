"""Shared verification of Supabase-issued access tokens.

Python never sees a credential in Art Loupe — the Next.js apps authenticate against
Supabase Auth directly and forward the resulting access token. This package is the single
implementation of "is this token genuinely Supabase's, still valid, and addressed to this
project", so no service re-derives it. See ADR 0002.
"""

from .config import AuthSettings, get_settings
from .tokens import (
    InvalidTokenError,
    KeyResolutionError,
    VerifiedToken,
    clear_key_cache,
    verify_access_token,
)

__all__ = [
    "AuthSettings",
    "InvalidTokenError",
    "KeyResolutionError",
    "VerifiedToken",
    "clear_key_cache",
    "get_settings",
    "verify_access_token",
]
