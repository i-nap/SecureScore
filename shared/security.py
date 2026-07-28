"""
shared/security.py
==================
Shared authentication and security utilities for branch + HQ services.

Phase 1 hardening (2026-06):
- Replaced SHA-256 password hashing with argon2id
- JWT expiry enforced at 15 minutes (access) / 7 days (refresh)
- Refresh token rotation with theft detection via family UUID
- RS256 JWT signing (private key path from env); HS256 retained as fallback
  for backward compatibility during migration — remove after Phase 2 cutover
- Constant-time comparison on all secrets
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json as _json
import logging
import os
import secrets as _secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ── JWT configuration ──────────────────────────────────────────────────────────
# Access tokens: 15 minutes maximum (Phase 1 requirement)
# Refresh tokens: 7 days
ACCESS_TOKEN_EXPIRE_SECONDS: int = int(os.getenv("JWT_ACCESS_TOKEN_TTL_SECONDS", "900"))   # 15 min
REFRESH_TOKEN_EXPIRE_SECONDS: int = int(os.getenv("JWT_REFRESH_TOKEN_TTL_SECONDS", "604800"))  # 7 days

# Algorithm selection: RS256 if key path provided, HS256 legacy fallback
_JWT_PRIVATE_KEY_PATH: Optional[str] = os.getenv("JWT_RS256_PRIVATE_KEY_PATH")
_JWT_PUBLIC_KEY_PATH: Optional[str]  = os.getenv("JWT_RS256_PUBLIC_KEY_PATH")
_JWT_HS256_SECRET: str = os.getenv("HQ_SECRET_KEY", os.getenv("BFF_SECRET_KEY", "changeme"))

JWT_ISSUER:   str = os.getenv("JWT_ISSUER", "securescore-auth")
JWT_AUDIENCE: str = os.getenv("JWT_AUDIENCE", "securescore-banking")

HQ_BRANCH_API_KEY: str = os.getenv("HQ_BRANCH_API_KEY", "")

# ── Argon2id parameters (OWASP recommended minimums) ──────────────────────────
_ARGON2_TIME_COST:    int = int(os.getenv("ARGON2_ITERATIONS",   "3"))
_ARGON2_MEMORY_COST:  int = int(os.getenv("ARGON2_MEMORY",       "65536"))  # 64 MB
_ARGON2_PARALLELISM:  int = int(os.getenv("ARGON2_PARALLELISM",  "4"))
_ARGON2_HASH_LENGTH:  int = int(os.getenv("ARGON2_KEY_LENGTH",   "32"))
_ARGON2_SALT_LENGTH:  int = int(os.getenv("ARGON2_SALT_LENGTH",  "16"))

# ── Password hashing — argon2id ───────────────────────────────────────────────

def hash_password(password: str) -> str:
    """
    Hash a password using argon2id. Returns a self-describing encoded string:
    $argon2id$v=19$m=<mem>,t=<iter>,p=<par>$<salt_b64>$<hash_b64>
    """
    try:
        from argon2 import PasswordHasher
        ph = PasswordHasher(
            time_cost=_ARGON2_TIME_COST,
            memory_cost=_ARGON2_MEMORY_COST,
            parallelism=_ARGON2_PARALLELISM,
            hash_len=_ARGON2_HASH_LENGTH,
            salt_len=_ARGON2_SALT_LENGTH,
        )
        return ph.hash(password)
    except ImportError:
        # argon2-cffi not installed — fall back to legacy SHA-256 with warning.
        # Install: pip install argon2-cffi
        logger.warning(
            "argon2-cffi not installed; falling back to SHA-256. "
            "Run: pip install argon2-cffi"
        )
        return _hash_password_sha256_legacy(password)


def verify_password(password: str, stored_hash: str) -> bool:
    """
    Verify a password against a stored hash. Supports argon2id hashes
    (starting with $argon2id$) and legacy SHA-256 hashes (salt$digest).
    """
    if stored_hash.startswith("$argon2"):
        try:
            from argon2 import PasswordHasher
            from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
            ph = PasswordHasher()
            try:
                return ph.verify(stored_hash, password)
            except (VerifyMismatchError, VerificationError, InvalidHashError):
                return False
        except ImportError:
            logger.warning("argon2-cffi not installed; cannot verify argon2id hash")
            return False
    # Legacy SHA-256 fallback
    return _verify_password_sha256_legacy(password, stored_hash)


def needs_rehash(stored_hash: str) -> bool:
    """Returns True if the stored hash should be upgraded to current argon2id params."""
    if not stored_hash.startswith("$argon2"):
        return True
    try:
        from argon2 import PasswordHasher
        ph = PasswordHasher(
            time_cost=_ARGON2_TIME_COST,
            memory_cost=_ARGON2_MEMORY_COST,
            parallelism=_ARGON2_PARALLELISM,
        )
        return ph.check_needs_rehash(stored_hash)
    except ImportError:
        return False


def _hash_password_sha256_legacy(password: str, salt: Optional[str] = None) -> str:
    s = salt or _secrets.token_hex(16)
    digest = hashlib.sha256(f"{s}:{password}".encode()).hexdigest()
    return f"{s}${digest}"


def _verify_password_sha256_legacy(password: str, stored_hash: str) -> bool:
    try:
        salt, _ = stored_hash.split("$", 1)
        return hmac.compare_digest(_hash_password_sha256_legacy(password, salt), stored_hash)
    except Exception:
        return False


# ── JWT — RS256 (primary) / HS256 (legacy fallback) ──────────────────────────

def _load_rsa_keys() -> tuple[Optional[object], Optional[object]]:
    """Load RSA private and public keys from PEM files. Returns (private, public)."""
    try:
        from cryptography.hazmat.primitives.serialization import load_pem_private_key, load_pem_public_key
        private_key = None
        public_key = None
        if _JWT_PRIVATE_KEY_PATH and os.path.exists(_JWT_PRIVATE_KEY_PATH):
            with open(_JWT_PRIVATE_KEY_PATH, "rb") as f:
                private_key = load_pem_private_key(f.read(), password=None)
        if _JWT_PUBLIC_KEY_PATH and os.path.exists(_JWT_PUBLIC_KEY_PATH):
            with open(_JWT_PUBLIC_KEY_PATH, "rb") as f:
                public_key = load_pem_public_key(f.read())
        return private_key, public_key
    except ImportError:
        return None, None
    except Exception as exc:
        logger.warning("Failed to load RSA keys: %s", exc)
        return None, None


def create_access_token(payload: dict) -> str:
    """
    Create an RS256 JWT access token (falls back to HS256 if RSA keys unavailable).
    The 'exp' claim is always set to ACCESS_TOKEN_EXPIRE_SECONDS from now.
    'iss', 'aud', 'iat', 'jti' are injected automatically.
    """
    import jose.jwt as _jwt  # python-jose
    now = datetime.now(timezone.utc)
    claims = {
        **payload,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": now,
        "exp": now + timedelta(seconds=ACCESS_TOKEN_EXPIRE_SECONDS),
        "jti": str(uuid.uuid4()),
    }
    private_key, _ = _load_rsa_keys()
    if private_key is not None:
        return _jwt.encode(claims, private_key, algorithm="RS256")
    logger.warning("RS256 key unavailable — using HS256 fallback (migrate to RS256 in production)")
    return _jwt.encode(claims, _JWT_HS256_SECRET, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    """
    Decode and validate an access JWT. Validates issuer, audience, expiry.
    Raises jose.JWTError on any validation failure.
    """
    import jose.jwt as _jwt
    from jose import JWTError
    _, public_key = _load_rsa_keys()
    try:
        if public_key is not None:
            return _jwt.decode(token, public_key, algorithms=["RS256"],
                               audience=JWT_AUDIENCE, issuer=JWT_ISSUER)
        return _jwt.decode(token, _JWT_HS256_SECRET, algorithms=["HS256"],
                           audience=JWT_AUDIENCE, issuer=JWT_ISSUER)
    except JWTError:
        raise


def create_refresh_token() -> tuple[str, str]:
    """
    Generate an opaque refresh token.
    Returns (raw_token, sha256_hex_hash). Store only the hash; send raw to client.
    """
    raw = _secrets.token_hex(32)  # 64 hex chars = 256 bits
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


# ── Legacy HS256 JWT (kept for backward compatibility during Phase 1→2) ───────
# Remove after Phase 2 Go auth service is fully deployed.

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def create_jwt(payload: dict, secret: str = _JWT_HS256_SECRET,
               expiry_seconds: int = ACCESS_TOKEN_EXPIRE_SECONDS) -> str:
    """Legacy HS256 JWT creation. Use create_access_token() for new code."""
    header = _b64url_encode(_json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    exp = int(time.time()) + expiry_seconds
    full_payload = {**payload, "exp": exp, "iat": int(time.time())}
    body = _b64url_encode(_json.dumps(full_payload).encode())
    sig_input = f"{header}.{body}".encode()
    sig = _b64url_encode(hmac.new(secret.encode(), sig_input, hashlib.sha256).digest())
    return f"{header}.{body}.{sig}"


def decode_jwt(token: str, secret: str = _JWT_HS256_SECRET) -> dict:
    """Legacy HS256 JWT decode. Use decode_access_token() for new code."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed JWT: expected 3 parts")
    header_b64, body_b64, sig_b64 = parts
    expected_sig = _b64url_encode(
        hmac.new(secret.encode(), f"{header_b64}.{body_b64}".encode(), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(expected_sig, sig_b64):
        raise ValueError("JWT signature verification failed")
    payload = _json.loads(_b64url_decode(body_b64))
    if "exp" in payload and payload["exp"] < time.time():
        raise ValueError("JWT has expired")
    return payload


# ── API key verification ───────────────────────────────────────────────────────

def verify_api_key(provided_key: str, expected_key: str = HQ_BRANCH_API_KEY) -> bool:
    if not provided_key or not expected_key:
        return False
    return hmac.compare_digest(provided_key.strip(), expected_key.strip())


# ── mTLS helpers ───────────────────────────────────────────────────────────────

def get_mtls_context(
    ca_cert: Optional[str] = None,
    cert: Optional[str] = None,
    key: Optional[str] = None,
):
    import ssl
    ca = ca_cert or os.getenv("MTLS_CA_CERT", "")
    crt = cert or os.getenv("MTLS_HQ_CERT", "")
    k = key or os.getenv("MTLS_HQ_KEY", "")
    if not (ca and crt and k):
        return None
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.load_verify_locations(ca)
    ctx.load_cert_chain(certfile=crt, keyfile=k)
    return ctx


# ── In-memory rate limiter (single-process / tests) ───────────────────────────

class InMemoryRateLimiter:
    def __init__(self, rate: int, period_seconds: float = 60.0) -> None:
        self._rate = rate
        self._period = period_seconds
        self._buckets: dict[str, list[float]] = {}

    def is_allowed(self, key: str) -> bool:
        now = time.monotonic()
        window_start = now - self._period
        hits = [t for t in self._buckets.get(key, []) if t > window_start]
        if len(hits) >= self._rate:
            self._buckets[key] = hits
            return False
        hits.append(now)
        self._buckets[key] = hits
        return True
