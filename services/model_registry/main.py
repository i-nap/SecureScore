"""
services/model_registry/main.py
================================
Model Registry microservice — global model versioning, pull, watermarking.
Port 5051.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import random
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel

try:
    from observability.logging_config import setup_logging
    setup_logging(service_name="model-registry")
except ImportError:
    logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
HQ_STATE_DIR = BASE_DIR / "hq_state"
MODEL_REGISTRY_DIR = HQ_STATE_DIR / "registry"
HQ_STATE_DIR.mkdir(exist_ok=True)
MODEL_REGISTRY_DIR.mkdir(exist_ok=True)

JWT_SECRET = os.getenv("HQ_SECRET_KEY", "")


def _verify_jwt(token: str) -> dict:
    import base64 as b64, hashlib, hmac as _hmac
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed token")
    header_b, payload_b, sig_b = parts
    expected = b64.urlsafe_b64encode(
        _hmac.new(JWT_SECRET.encode(), f"{header_b}.{payload_b}".encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    if not _hmac.compare_digest(sig_b, expected):
        raise ValueError("Invalid signature")
    payload_padded = payload_b + "=" * (-len(payload_b) % 4)
    claims = json.loads(b64.urlsafe_b64decode(payload_padded))
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
    logger.info("Model Registry service starting")
    yield
    logger.info("Model Registry service shutting down")


app = FastAPI(
    title="SecureScore — Model Registry",
    version="1.0.0",
    description="Global model versioning, distribution, watermarking.",
    lifespan=lifespan,
)


def _list_versions() -> list[int]:
    return sorted(
        int(p.stem.split("_v")[1])
        for p in MODEL_REGISTRY_DIR.glob("global_model_v*.json")
        if p.stem.split("_v")[-1].isdigit()
    )


def _load_version(version: int) -> dict | None:
    path = MODEL_REGISTRY_DIR / f"global_model_v{version}.json"
    return json.loads(path.read_text()) if path.exists() else None


@app.get("/api/health")
def health():
    versions = _list_versions()
    return {"status": "ok", "service": "model-registry", "total_versions": len(versions)}


@app.get("/api/latest_model")
def latest_model(_claims: dict = Depends(auth_dep)):
    path = HQ_STATE_DIR / "global_model_latest.json"
    if not path.exists():
        return {"status": "not_ready"}
    return json.loads(path.read_text())


@app.get("/api/global_model")
def global_model(_claims: dict = Depends(auth_dep)):
    return latest_model(_claims)


@app.get("/api/model_registry")
def model_registry():
    versions = _list_versions()
    return {"versions": versions, "active_version": versions[-1] if versions else 0, "total": len(versions)}


@app.get("/api/model_registry/{version}")
def get_model_version(version: int, _claims: dict = Depends(auth_dep)):
    record = _load_version(version)
    if record is None:
        raise HTTPException(404, f"Version {version} not found")
    return record


# ── Watermarking (IP protection demo) ─────────────────────

_watermark_store: dict[str, dict] = {}


class WatermarkEmbedRequest(BaseModel):
    model_version: int
    watermark_key: str
    owner: str = "SecureScore-HQ"


class WatermarkVerifyRequest(BaseModel):
    model_version: int
    watermark_key: str


@app.post("/security/watermark_embed")
def watermark_embed(req: WatermarkEmbedRequest, _claims: dict = Depends(auth_dep)):
    record = _load_version(req.model_version)
    if record is None:
        raise HTTPException(404, f"Version {req.model_version} not found")

    model_hash = record.get("weights", {}).get("sha256_hash", "")
    wm_hash = hashlib.sha256(
        f"{req.watermark_key}:{model_hash}:{req.owner}".encode()
    ).hexdigest()

    _watermark_store[str(req.model_version)] = {
        "version": req.model_version,
        "watermark_hash": wm_hash,
        "owner": req.owner,
        "embedded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model_hash": model_hash,
    }

    return {
        "status": "watermarked",
        "version": req.model_version,
        "watermark_hash": wm_hash[:16] + "…",
        "owner": req.owner,
    }


@app.post("/security/watermark_verify")
def watermark_verify(req: WatermarkVerifyRequest, _claims: dict = Depends(auth_dep)):
    stored = _watermark_store.get(str(req.model_version))
    if stored is None:
        return {"verified": False, "reason": "No watermark found for this version"}

    record = _load_version(req.model_version)
    model_hash = record.get("weights", {}).get("sha256_hash", "") if record else ""
    wm_hash = hashlib.sha256(
        f"{req.watermark_key}:{model_hash}:{stored['owner']}".encode()
    ).hexdigest()

    match = wm_hash == stored["watermark_hash"]
    return {
        "verified": match,
        "version": req.model_version,
        "owner": stored["owner"] if match else None,
        "embedded_at": stored["embedded_at"] if match else None,
    }


@app.get("/security/watermark_status")
def watermark_status():
    return {
        "watermarked_versions": list(_watermark_store.keys()),
        "total": len(_watermark_store),
    }
