"""Verification behaviour for forwarded Supabase access tokens.

Tagged `security` rather than `functionality`: every case here is a way an attacker gets
in if the answer is wrong, not a feature that stops working.
"""

import base64
import hashlib
import hmac
import json
import time

import httpx
import jwt
import pytest
import respx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from artloupe.auth.config import AuthSettings
from artloupe.auth.tokens import (
    ASYMMETRIC_ALGORITHMS,
    SYMMETRIC_ALGORITHMS,
    InvalidTokenError,
    KeyResolutionError,
    clear_key_cache,
    verify_access_token,
)

pytestmark = pytest.mark.trace(flow="platform.auth", category="security")

SUPABASE_URL = "http://127.0.0.1:54321"
ISSUER = f"{SUPABASE_URL}/auth/v1"
JWKS_URL = f"{ISSUER}/.well-known/jwks.json"
KEY_ID = "test-signing-key"


@pytest.fixture
def settings() -> AuthSettings:
    return AuthSettings(supabase_url=SUPABASE_URL, supabase_anon_key="anon-key")


@pytest.fixture
def signing_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def jwks(signing_key: ec.EllipticCurvePrivateKey) -> dict:
    public_jwk = jwt.algorithms.ECAlgorithm.to_jwk(signing_key.public_key(), as_dict=True)
    public_jwk.update({"kid": KEY_ID, "use": "sig", "alg": "ES256"})
    return {"keys": [public_jwk]}


@pytest.fixture(autouse=True)
def _isolate_key_cache():
    """The JWKS cache is process-wide; a leaked entry would mask a fetch failure."""
    clear_key_cache()
    yield
    clear_key_cache()


def make_token(
    signing_key: ec.EllipticCurvePrivateKey,
    **overrides,
) -> str:
    """A token shaped like Supabase's, with individual claims overridable per test."""
    now = int(time.time())
    claims = {
        "sub": "3f1a0c6e-0000-4000-8000-000000000001",
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now,
        "exp": now + 3600,
        "email": "artist@example.test",
        "app_metadata": {"artloupe_role": "operator"},
    }
    claims.update(overrides)
    return jwt.encode(claims, signing_key, algorithm="ES256", headers={"kid": KEY_ID})


@respx.mock
async def test_accepts_a_well_formed_token(settings, signing_key, jwks):
    respx.get(JWKS_URL).mock(return_value=httpx.Response(200, json=jwks))

    async with httpx.AsyncClient() as client:
        verified = await verify_access_token(make_token(signing_key), client, settings)

    assert verified.subject == "3f1a0c6e-0000-4000-8000-000000000001"
    assert verified.email == "artist@example.test"
    assert verified.role == "operator"


@respx.mock
async def test_rejects_an_expired_token(settings, signing_key, jwks):
    respx.get(JWKS_URL).mock(return_value=httpx.Response(200, json=jwks))
    expired = make_token(signing_key, exp=int(time.time()) - 60)

    async with httpx.AsyncClient() as client:
        with pytest.raises(InvalidTokenError):
            await verify_access_token(expired, client, settings)


@respx.mock
async def test_rejects_a_token_from_another_issuer(settings, signing_key, jwks):
    """A token minted by a different Supabase project must not authenticate here."""
    respx.get(JWKS_URL).mock(return_value=httpx.Response(200, json=jwks))
    foreign = make_token(signing_key, iss="https://someone-elses-project.supabase.co/auth/v1")

    async with httpx.AsyncClient() as client:
        with pytest.raises(InvalidTokenError):
            await verify_access_token(foreign, client, settings)


@respx.mock
async def test_rejects_a_token_with_the_wrong_audience(settings, signing_key, jwks):
    respx.get(JWKS_URL).mock(return_value=httpx.Response(200, json=jwks))
    wrong_audience = make_token(signing_key, aud="some-other-audience")

    async with httpx.AsyncClient() as client:
        with pytest.raises(InvalidTokenError):
            await verify_access_token(wrong_audience, client, settings)


def _b64url(raw: bytes) -> str:
    """Unpadded base64url, as JWS requires."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


@respx.mock
async def test_rejects_algorithm_confusion(settings, signing_key, jwks):
    """The classic JWT attack: re-sign as HS256 using the *public* key as the HMAC secret.

    Forged by hand because `jwt.encode` refuses to HMAC-sign with a PEM key — an attacker
    is under no obligation to use PyJWT.

    Be precise about what this proves. TWO layers reject the token: our pinned algorithm
    list, and PyJWT's own refusal to accept an asymmetric key as an HMAC secret on decode.
    This test cannot tell which one fired, so it locks the observable behaviour and nothing
    more. The pinning itself is asserted directly in `test_asymmetric_mode_excludes_hmac`,
    which is the test that would fail if someone widened the list.
    """
    respx.get(JWKS_URL).mock(return_value=httpx.Response(200, json=jwks))
    public_pem = signing_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    now = int(time.time())
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT", "kid": KEY_ID}).encode())
    payload = _b64url(
        json.dumps(
            {
                "sub": "attacker",
                "aud": "authenticated",
                "iss": ISSUER,
                "exp": now + 3600,
                "app_metadata": {"artloupe_role": "superuser"},
            }
        ).encode()
    )
    signing_input = f"{header}.{payload}".encode()
    signature = _b64url(hmac.new(public_pem, signing_input, hashlib.sha256).digest())
    forged = f"{header}.{payload}.{signature}"

    async with httpx.AsyncClient() as client:
        with pytest.raises(InvalidTokenError):
            await verify_access_token(forged, client, settings)


@respx.mock
async def test_rejects_an_unknown_signing_key(settings, jwks):
    """A token signed by a key the project never published is forged, not an outage."""
    respx.get(JWKS_URL).mock(return_value=httpx.Response(200, json=jwks))
    attacker_key = ec.generate_private_key(ec.SECP256R1())

    async with httpx.AsyncClient() as client:
        with pytest.raises(InvalidTokenError):
            await verify_access_token(
                jwt.encode({"sub": "x"}, attacker_key, algorithm="ES256", headers={"kid": "other"}),
                client,
                settings,
            )


@respx.mock
async def test_unreachable_keys_are_an_outage_not_a_rejection(settings, signing_key):
    """503, not 401. A Supabase blip must not read as "your token is bad"."""
    respx.get(JWKS_URL).mock(return_value=httpx.Response(500))

    async with httpx.AsyncClient() as client:
        with pytest.raises(KeyResolutionError):
            await verify_access_token(make_token(signing_key), client, settings)


@respx.mock
async def test_role_defaults_to_artist_without_app_metadata(settings, signing_key, jwks):
    respx.get(JWKS_URL).mock(return_value=httpx.Response(200, json=jwks))
    plain = make_token(signing_key, app_metadata={})

    async with httpx.AsyncClient() as client:
        verified = await verify_access_token(plain, client, settings)

    assert verified.role == "artist"


@respx.mock
async def test_ignores_a_role_claimed_in_user_metadata(settings, signing_key, jwks):
    """`user_metadata` is user-writable. Honouring a role there is self-service escalation."""
    respx.get(JWKS_URL).mock(return_value=httpx.Response(200, json=jwks))
    escalated = make_token(
        signing_key,
        app_metadata={},
        user_metadata={"artloupe_role": "superuser"},
    )

    async with httpx.AsyncClient() as client:
        verified = await verify_access_token(escalated, client, settings)

    assert verified.role == "artist"


@respx.mock
async def test_reuses_the_cached_key_set(settings, signing_key, jwks):
    """Two verifications, one JWKS fetch — otherwise every request hits Supabase."""
    route = respx.get(JWKS_URL).mock(return_value=httpx.Response(200, json=jwks))

    async with httpx.AsyncClient() as client:
        await verify_access_token(make_token(signing_key), client, settings)
        await verify_access_token(make_token(signing_key), client, settings)

    assert route.call_count == 1


async def test_rejects_an_empty_token(settings):
    async with httpx.AsyncClient() as client:
        with pytest.raises(InvalidTokenError):
            await verify_access_token("", client, settings)


# @trace inherited from the module-level pytestmark.
def test_asymmetric_mode_excludes_hmac():
    """The pinning invariant, asserted directly rather than inferred from a rejection.

    `verify_access_token` decides the permitted algorithm from the configured *mode*, never
    from the token header. Widening either list to span both families would reintroduce
    algorithm confusion, and the behavioural test above would not catch it — PyJWT's key
    handling happens to reject the specific PEM-as-secret variant either way.
    """
    assert "HS256" not in ASYMMETRIC_ALGORITHMS
    assert not set(ASYMMETRIC_ALGORITHMS) & set(SYMMETRIC_ALGORITHMS)
    assert all(algorithm.startswith(("ES", "RS", "Ed")) for algorithm in ASYMMETRIC_ALGORITHMS)
    assert all(algorithm.startswith("HS") for algorithm in SYMMETRIC_ALGORITHMS)
