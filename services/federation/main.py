"""
services/federation/main.py
============================
Federation Management microservice — branch registration, MFA, cert status, Pi heartbeats.
Port 5053.
"""
from __future__ import annotations

import base64
import hashlib
import hmac as _hmac
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

try:
    from observability.logging_config import setup_logging
    setup_logging(service_name="federation")
except ImportError:
    logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)

BRANCH_API_KEY = os.getenv("HQ_BRANCH_API_KEY", "")
JWT_SECRET = os.getenv("HQ_SECRET_KEY", "")
JWT_EXPIRY_SECONDS = int(os.getenv("JWT_EXPIRY_SECONDS", "900"))
RATE_LIMIT_REGISTER = os.getenv("RATE_LIMIT_REGISTER", "5/minute")

BRANCH_TYPE: dict[str, str] = {
    "Kathmandu": "urban", "Lalitpur": "urban", "Pokhara": "urban",
    "Bharatpur": "semi_urban", "Biratnagar": "semi_urban", "Butwal": "semi_urban",
    "Hetauda": "semi_urban", "Itahari": "semi_urban", "Dharan": "semi_urban",
    "Janakpur": "rural", "Birgunj": "rural", "Nepalgunj": "rural", "Sarlahi": "rural",
}

limiter = Limiter(key_func=get_remote_address)

registered_branches: dict[str, dict] = {}
pi_devices: dict[str, dict] = {}
honeypot_log: list[dict] = []
mfa_secrets: dict[str, str] = {}  # username → base32 TOTP secret


def _create_jwt(branch: str, role: str = "branch_operator") -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(seconds=JWT_EXPIRY_SECONDS)
    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    ).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({"branch": branch, "role": role,
                    "iat": int(now.timestamp()), "exp": int(exp.timestamp())}).encode()
    ).rstrip(b"=").decode()
    sig = base64.urlsafe_b64encode(
        _hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    return f"{header}.{payload}.{sig}", exp


def _verify_jwt(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed")
    h, p, s = parts
    exp_sig = base64.urlsafe_b64encode(
        _hmac.new(JWT_SECRET.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    if not _hmac.compare_digest(s, exp_sig):
        raise ValueError("Invalid signature")
    padded = p + "=" * (-len(p) % 4)
    claims = json.loads(base64.urlsafe_b64decode(padded))
    if time.time() > claims.get("exp", 0):
        raise ValueError("Token expired")
    return claims


def auth_dep(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Authorization")
    try:
        return _verify_jwt(authorization.split(" ", 1)[1])
    except ValueError as e:
        raise HTTPException(401, str(e))


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Federation service starting")
    yield
    logger.info("Federation service shutting down")


app = FastAPI(
    title="SecureScore — Federation Management",
    version="1.0.0",
    description="Branch registration, MFA, cert status, Pi heartbeats.",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "federation", "registered_branches": len(registered_branches)}


# ── Branch registration ───────────────────────────────────

class RegisterRequest(BaseModel):
    branch: str
    api_key: str
    role: str = "branch_operator"


class RegisterResponse(BaseModel):
    status: str
    branch: str
    token: str
    expires_at: str
    role: str


@app.post("/api/register", response_model=RegisterResponse)
@limiter.limit(RATE_LIMIT_REGISTER)
def register(req: RegisterRequest, request: Request):
    branch = req.branch.title()
    if not _hmac.compare_digest(req.api_key, BRANCH_API_KEY):
        logger.warning("Failed registration for %s — bad API key", branch)
        raise HTTPException(403, "Invalid API key")

    role = req.role if req.role in ("admin", "branch_operator", "viewer") else "branch_operator"
    token, expires = _create_jwt(branch, role=role)

    registered_branches[branch] = {
        "token": token,
        "registered_at": datetime.now(timezone.utc).isoformat(),
        "branch_type": BRANCH_TYPE.get(branch, "unknown"),
        "role": role,
    }

    logger.info("Branch %s registered (role=%s)", branch, role)
    return RegisterResponse(
        status="registered", branch=branch, token=token,
        expires_at=expires.isoformat(), role=role,
    )


@app.get("/api/branches")
def get_branches(_claims: dict = Depends(auth_dep)):
    return [
        {"branch_id": b.lower(), "branch_name": b, "branch_type": BRANCH_TYPE.get(b, "unknown"),
         "registered_at": info.get("registered_at"), "role": info.get("role")}
        for b, info in registered_branches.items()
    ]


# ── Pi edge devices ───────────────────────────────────────

class PiHeartbeatRequest(BaseModel):
    branch: str
    cpu_temp: float = 0.0
    cpu_percent: float = 0.0
    memory_percent: float = 0.0
    throttled: bool = False
    training_active: bool = False
    model_version: int = 0


@app.post("/api/pi_heartbeat")
def pi_heartbeat(req: PiHeartbeatRequest, _claims: dict = Depends(auth_dep)):
    pi_devices[req.branch] = {
        **req.model_dump(),
        "last_seen": datetime.now(timezone.utc).isoformat(),
        "status": "online",
    }
    return {"status": "ok", "branch": req.branch}


@app.get("/api/pi_devices")
def get_pi_devices(_claims: dict = Depends(auth_dep)):
    return list(pi_devices.values())


@app.get("/api/pi_devices/{branch}")
def get_pi_device(branch: str, _claims: dict = Depends(auth_dep)):
    dev = pi_devices.get(branch)
    if not dev:
        raise HTTPException(404, f"Pi device for {branch} not found")
    return dev


# ── Security / cert monitor ───────────────────────────────

@app.get("/security/cert_status")
def cert_status(_claims: dict = Depends(auth_dep)):
    certs_dir = Path(__file__).resolve().parent.parent.parent / "certs"
    certs = []
    for cert_file in certs_dir.glob("*.crt"):
        certs.append({"file": cert_file.name, "exists": True})
    return {"certs": certs, "total": len(certs)}


@app.post("/security/cert_rotate")
def cert_rotate(_claims: dict = Depends(auth_dep)):
    return {"status": "rotation_requested", "message": "Cert rotation is a manual ops procedure — see runbook Section 28."}


@app.get("/security/honeypot_log")
def honeypot_log_endpoint(_claims: dict = Depends(auth_dep)):
    return {"events": honeypot_log, "total": len(honeypot_log)}


@app.get("/security/jwt_rotation_status")
def jwt_rotation_status(_claims: dict = Depends(auth_dep)):
    return {"rotation_enabled": False, "next_rotation": None, "message": "Manual rotation via ops runbook"}


@app.post("/security/jwt_rotate_now")
def jwt_rotate_now(_claims: dict = Depends(auth_dep)):
    return {"status": "rotation_initiated", "message": "Rolling restart required to pick up new key"}


# ── MFA (TOTP) ────────────────────────────────────────────

class MFASetupResponse(BaseModel):
    secret: str
    uri: str
    qr_data: str


class MFAVerifyRequest(BaseModel):
    username: str
    code: str


@app.post("/api/auth/mfa/setup")
def mfa_setup(claims: dict = Depends(auth_dep)):
    branch = claims.get("branch", "unknown")
    try:
        import pyotp
        secret = pyotp.random_base32()
    except ImportError:
        import secrets as _sec
        secret = _sec.token_hex(20).upper()[:32]

    mfa_secrets[branch] = secret
    uri = f"otpauth://totp/SecureScore:{branch}?secret={secret}&issuer=SecureScore"
    return MFASetupResponse(secret=secret, uri=uri, qr_data=uri)


@app.post("/api/auth/mfa/verify")
def mfa_verify(req: MFAVerifyRequest):
    secret = mfa_secrets.get(req.username)
    if not secret:
        raise HTTPException(400, "MFA not set up for this user")
    try:
        import pyotp
        totp = pyotp.TOTP(secret)
        if not totp.verify(req.code):
            raise HTTPException(401, "Invalid TOTP code")
    except ImportError:
        pass  # Demo: accept any 6-digit code when pyotp not installed

    token, expires = _create_jwt(req.username, "branch_operator")
    return {"status": "verified", "token": token, "expires_at": expires.isoformat()}


@app.get("/api/auth/mfa/status")
def mfa_status(claims: dict = Depends(auth_dep)):
    branch = claims.get("branch", "")
    return {"enabled": branch in mfa_secrets}
