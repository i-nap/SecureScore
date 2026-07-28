"""
branch_service/api.py
=====================
FastAPI service implementing the /api/v1 branch endpoints.
"""

from __future__ import annotations

import os
from pathlib import Path
import asyncio
import logging
import time
import hmac
import hashlib
from datetime import datetime, timedelta
from typing import Any

from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel

from branch_service.models import EnsembleModel
from branch_service.model_cache_manager import ModelCacheManager
from branch_service.scoring_immediate_approval import ImmediateApprovalScoring

try:
    from db.models import GradientUpload, get_session
except Exception:
    GradientUpload = None
    get_session = None


class ScoringRequest(BaseModel):
    customer_id: str
    age: int | None = None
    income: float | None = None
    savings_balance: float | None = None
    employment: str | None = None
    transaction_count_30d: int | None = None
    extra: dict[str, Any] | None = None


class GradientsUploadRequest(BaseModel):
    branch_id: str
    timestamp: str
    data_volume: int
    model_version: str
    compressed_gradients: dict


app = FastAPI(title="Branch Service", version="1.0.0")

BRANCH_ID = os.getenv("BRANCH_ID", "branch-001")
MODEL_PATH = os.getenv("BRANCH_MODEL_PATH", "branch_state/local_ensemble.json")
HQ_BASE_URL = os.getenv("HQ_BASE_URL", "http://127.0.0.1:6051")
CACHE_DIR = os.getenv("BRANCH_CACHE_DIR", "branch_state/cache")
BACKUP_DIR = os.getenv("BRANCH_CACHE_BACKUP", "branch_state/cache_backup")
HQ_VERIFY_URL = os.getenv("HQ_VERIFY_URL", "http://127.0.0.1:6051/api/v1/verify/background")
SPEC_SERVICE_TOKEN = os.getenv("SPEC_SERVICE_TOKEN", "")
SPEC_JWT_SECRET = os.getenv("SPEC_JWT_SECRET", "")
SPEC_TLS_CERT = os.getenv("SPEC_TLS_CERT", "")
SPEC_TLS_KEY = os.getenv("SPEC_TLS_KEY", "")
SPEC_MTLS_CA_CERT = os.getenv("SPEC_MTLS_CA_CERT", "")

logger = logging.getLogger("branch.api")

cache_manager = ModelCacheManager(
    CACHE_DIR,
    BACKUP_DIR,
    HQ_BASE_URL,
    BRANCH_ID,
)

local_model = None
if Path(MODEL_PATH).exists():
    try:
        local_model = EnsembleModel.load_model(MODEL_PATH)
    except Exception:
        local_model = None

cache_manager.local_fallback = local_model
cached_model = cache_manager.load_cached_global_model()
branch_weights = cache_manager.load_cached_personalized_weights(BRANCH_ID)

scoring_service = ImmediateApprovalScoring(
    branch_id=BRANCH_ID,
    local_models=local_model,
    cached_hq_model=cached_model,
    cached_branch_weights=branch_weights,
    cached_hq_weights=branch_weights,
    percentile_distribution=None,
    hq_submit_url=HQ_VERIFY_URL,
)


async def _schedule_daily_cache_refresh() -> None:
    while True:
        now = datetime.now()
        next_run = now.replace(hour=2, minute=0, second=0, microsecond=0)
        if next_run <= now:
            next_run = next_run + timedelta(days=1)
        delay = (next_run - now).total_seconds()
        await asyncio.sleep(max(1.0, delay))
        try:
            await cache_manager.daily_cache_refresh()
        except Exception:
            logger.exception("Scheduled cache refresh failed")


@app.on_event("startup")
async def _startup_tasks():
    asyncio.create_task(_schedule_daily_cache_refresh())


def _require_spec_auth(authorization: str | None = Header(None)) -> None:
    if not SPEC_SERVICE_TOKEN and not SPEC_JWT_SECRET:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = authorization.split(" ", 1)[1].strip()

    if SPEC_JWT_SECRET:
        parts = token.split(".")
        if len(parts) != 3:
            raise HTTPException(status_code=401, detail="Malformed token")
        h, p, sig = parts
        expected = hmac.new(SPEC_JWT_SECRET.encode(), f"{h}.{p}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise HTTPException(status_code=401, detail="Invalid token signature")
        try:
            import base64, json
            payload = json.loads(base64.urlsafe_b64decode(p + "=="))
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        if payload.get("exp", 0) < time.time():
            raise HTTPException(status_code=401, detail="Token expired")
        return

    if token != SPEC_SERVICE_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "branch_id": BRANCH_ID,
        "local_model_loaded": local_model is not None,
        "cached_hq_model_loaded": cached_model is not None,
    }


@app.post("/api/v1/scoring")
async def scoring(req: ScoringRequest, _auth: None = Depends(_require_spec_auth)):
    payload = req.model_dump()
    extra = payload.pop("extra", None) or {}
    payload.update(extra)
    result = await scoring_service.score_and_approve_customer(payload)
    if result.get("decision") == "ERROR":
        raise HTTPException(status_code=500, detail=result.get("message"))
    return result


@app.post("/api/v1/gradients/upload")
def upload_gradients(req: GradientsUploadRequest, _auth: None = Depends(_require_spec_auth)):
    if GradientUpload is not None and get_session is not None:
        db = get_session()
        try:
            db.add(
                GradientUpload(
                    branch_id=req.branch_id,
                    data_volume=req.data_volume,
                    compressed_gradients=req.compressed_gradients,
                    model_version=req.model_version,
                )
            )
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

    return {
        "status": "success",
        "message": "Gradients accepted",
        "timestamp": req.timestamp,
    }


@app.get("/api/v1/models/weights")
def get_model_weights(_auth: None = Depends(_require_spec_auth)):
    base_model = None
    if cached_model is not None:
        base_model = {
            "feature_count": len(cached_model.feature_names),
            "training_metadata": cached_model.training_metadata,
        }

    return {
        "status": "success",
        "base_model": base_model,
        "ensemble_weights": branch_weights,
        "model_version": os.getenv("HQ_MODEL_VERSION", "v1"),
    }


if __name__ == "__main__":
    import uvicorn
    ssl_kwargs = {}
    if SPEC_TLS_CERT and SPEC_TLS_KEY:
        ssl_kwargs["ssl_certfile"] = SPEC_TLS_CERT
        ssl_kwargs["ssl_keyfile"] = SPEC_TLS_KEY
        if SPEC_MTLS_CA_CERT:
            import ssl
            ssl_kwargs["ssl_ca_certs"] = SPEC_MTLS_CA_CERT
            ssl_kwargs["ssl_cert_reqs"] = ssl.CERT_REQUIRED

    uvicorn.run(
        "branch_service.api:app",
        host="0.0.0.0",
        port=6050,
        reload=False,
        **ssl_kwargs,
    )
