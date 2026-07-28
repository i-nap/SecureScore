"""JWT auth helpers shared across HQ microservices."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException

from .config import JWT_ALGORITHM, JWT_EXPIRY_SECONDS, JWT_SECRET


def create_jwt(branch: str, role: str = "branch_operator") -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(seconds=JWT_EXPIRY_SECONDS)
    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    ).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({
            "branch": branch, "role": role,
            "iat": int(now.timestamp()), "exp": int(exp.timestamp()),
        }).encode()
    ).rstrip(b"=").decode()
    sig_input = f"{header}.{payload}".encode()
    sig = base64.urlsafe_b64encode(
        hmac.new(JWT_SECRET.encode(), sig_input, hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    return f"{header}.{payload}.{sig}", exp


def verify_jwt(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed token")
    header_b, payload_b, sig_b = parts
    expected = base64.urlsafe_b64encode(
        hmac.new(JWT_SECRET.encode(), f"{header_b}.{payload_b}".encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    if not hmac.compare_digest(sig_b, expected):
        raise ValueError("Invalid signature")
    payload_padded = payload_b + "=" * (-len(payload_b) % 4)
    claims = json.loads(base64.urlsafe_b64decode(payload_padded))
    if time.time() > claims.get("exp", 0):
        raise ValueError("Token expired")
    return claims


def auth_dependency(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Authorization header")
    try:
        return verify_jwt(authorization.split(" ", 1)[1])
    except ValueError as e:
        raise HTTPException(401, f"Auth failed: {e}")


def require_role(*roles: str):
    def checker(claims: dict = Depends(auth_dependency)):
        if claims.get("role") not in roles:
            raise HTTPException(403, f"Role '{claims.get('role')}' not allowed")
        return claims
    return checker
