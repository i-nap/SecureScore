"""
pi_edge/pi_api.py

FastAPI service for the Raspberry Pi branch edge node.
Re-implements all edge_api.py endpoints using Pi-optimised model config,
plus Pi-specific endpoints: /api/hardware, /api/pi_status, /api/flush_buffer.

Usage:
    python pi_edge/pi_api.py --branch kathmandu --port 7050
    python pi_edge/pi_api.py --branch sarlahi --port 7060
"""

from __future__ import annotations

import os
import sys
import json
import logging
import argparse
from pathlib import Path
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from dotenv import load_dotenv
load_dotenv()

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Add parent to path for edge_node
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import edge_node

from pi_edge.pi_config import PI_MODEL_CONFIG, DEFAULT_EDGE_PORT, DEFAULT_BRANCH_NAME
from pi_edge.pi_hardware import get_hardware_snapshot
from pi_edge.pi_edge_node import PiEdgeNode

# ═══════════════════════════════════════════════════════════
#  State
# ═══════════════════════════════════════════════════════════

class PiState:
    def __init__(self):
        self.branch_name: str = ""
        self.model = None
        self.ucp_local: pd.DataFrame | None = None
        self.feature_cols: list = []
        self.scaler = None
        self.metrics: dict = {}
        self.ready = False
        self.pi_node: PiEdgeNode | None = None
        self.logger = None

_state = PiState()
logger = logging.getLogger("pi_api")

# ═══════════════════════════════════════════════════════════
#  App
# ═══════════════════════════════════════════════════════════

@asynccontextmanager
async def _lifespan(application: FastAPI):
    import asyncio
    task = None
    # _state.pi_node is set by _init_pi_branch() before uvicorn starts
    if _state.pi_node is not None:
        task = asyncio.create_task(_state.pi_node.run_heartbeat_loop())
        logger.info("Pi heartbeat loop started (interval=%ds)", 30)
    yield
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    logger.info("Pi heartbeat loop stopped")

app = FastAPI(title="SecureScore Pi Edge API", version="1.0.0", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

# ═══════════════════════════════════════════════════════════
#  Pydantic models
# ═══════════════════════════════════════════════════════════

class ExplainRequest(BaseModel):
    customer_id: str

# ═══════════════════════════════════════════════════════════
#  Endpoints — standard (mirrors edge_api.py)
# ═══════════════════════════════════════════════════════════

@app.get("/api/health")
def health():
    hw = get_hardware_snapshot()
    return {
        "status":          "alive" if _state.ready else "initializing",
        "branch":          _state.branch_name,
        "model_loaded":    _state.model is not None,
        "customers_loaded": len(_state.ucp_local) if _state.ucp_local is not None else 0,
        "cpu_temp_c":      hw.get("cpu_temp_c"),
        "online":          True,
        "pi_device":       True,
    }


@app.get("/api/metrics")
def get_metrics():
    if not _state.ready:
        raise HTTPException(503, "Model not ready yet")
    ucp = _state.ucp_local
    branch_type = edge_node.BRANCH_TYPE.get(_state.branch_name.title(), "unknown")
    total = len(ucp)
    creditworthy = int((ucp.get("alternative_credit_score", pd.Series()) >= 600).sum()) \
                   if "alternative_credit_score" in ucp.columns else 0
    return {
        "branch":       _state.branch_name.title(),
        "branch_type":  branch_type,
        "model_metrics": _state.metrics,
        "data_stats": {
            "total_customers": total,
            "creditworthy":    creditworthy,
            "not_creditworthy": total - creditworthy,
            "approval_rate":   round(creditworthy / max(total, 1), 4),
        },
        "pi_model_config": PI_MODEL_CONFIG,
    }


@app.get("/api/score")
def get_score(customer_id: str = Query(...)):
    if not _state.ready:
        raise HTTPException(503, "Model not ready yet")
    ucp = _state.ucp_local
    row = ucp[ucp["customer_id"] == customer_id]
    if row.empty:
        raise HTTPException(404, f"Customer {customer_id} not found")
    df = row.copy()
    for col in edge_node.CATEGORICAL_ENCODE:
        if col in df.columns:
            from sklearn.preprocessing import LabelEncoder
            df[col] = LabelEncoder().fit_transform(df[col].astype(str))
    available = [c for c in _state.feature_cols if c in df.columns]
    x = df[available].fillna(0).values
    x_scaled = _state.scaler.transform(x)
    pred = _state.model.predict(x_scaled)[0]
    prob = _state.model.predict_proba(x_scaled)[0]
    r = row.iloc[0]
    return {
        "customer_id":                  customer_id,
        "prediction":                   "creditworthy" if pred == 1 else "not_creditworthy",
        "probability_creditworthy":      round(float(prob[1]), 4),
        "probability_not_creditworthy":  round(float(prob[0]), 4),
        "alt_credit_score":             round(float(r.get("alternative_credit_score", 0)), 1),
        "monthly_income":               round(float(r.get("monthly_income", 0)), 0),
        "branch":                       _state.branch_name.title(),
        "pi_device":                    True,
    }


@app.get("/api/customers")
def list_customers(page: int = Query(1, ge=1), per_page: int = Query(25, ge=5, le=100)):
    if not _state.ready:
        raise HTTPException(503, "Not ready")
    ucp = _state.ucp_local
    total = len(ucp)
    start = (page - 1) * per_page
    subset = ucp.iloc[start:start + per_page]
    customers = []
    for _, r in subset.iterrows():
        customers.append({
            "customer_id":    r.get("customer_id", ""),
            "alt_credit_score": round(float(r.get("alternative_credit_score", 0)), 1),
            "monthly_income": round(float(r.get("monthly_income", 0)), 0),
            "cibil_score":    int(r.get("cibil_score", 0)),
            "dti":            round(float(r.get("debt_to_income_ratio", 0)), 3),
        })
    return {
        "customers":   customers,
        "total":       total,
        "page":        page,
        "per_page":    per_page,
        "total_pages": (total + per_page - 1) // per_page,
    }


# ═══════════════════════════════════════════════════════════
#  Endpoints — Pi-specific
# ═══════════════════════════════════════════════════════════

@app.get("/api/hardware")
def hardware():
    """Return current Pi hardware snapshot."""
    return get_hardware_snapshot()


@app.get("/api/pi_status")
def pi_status():
    """Extended status including Pi config and offline buffer state."""
    if not _state.ready:
        raise HTTPException(503, "Not ready")
    hw = get_hardware_snapshot()
    node = _state.pi_node
    return {
        "branch":          _state.branch_name.title(),
        "online":          True,
        "pi_device":       True,
        "offline_rounds":  node.get_hardware_metrics()["offline_rounds"] if node else 0,
        "pi_config":       PI_MODEL_CONFIG,
        "hardware":        hw,
        "model_metrics":   _state.metrics,
    }


@app.post("/api/flush_buffer")
def flush_buffer():
    """Submit all offline-buffered weight rounds to HQ."""
    if _state.pi_node is None:
        raise HTTPException(503, "Pi node not initialized")
    count = _state.pi_node.flush_offline_buffer()
    return {"flushed_rounds": count, "status": "ok"}


@app.post("/api/submit_weights")
def submit_weights():
    """Trigger weight submission to HQ (with offline fallback)."""
    if _state.pi_node is None:
        raise HTTPException(503, "Pi node not initialized")
    success = _state.pi_node.submit_weights_with_offline_fallback()
    return {"submitted": success, "offline_buffered": not success}


# ═══════════════════════════════════════════════════════════
#  Startup
# ═══════════════════════════════════════════════════════════

def _init_pi_branch(branch_name: str, hq_url: str, api_key: str):
    br = branch_name.lower().replace(" ", "_")
    _state.branch_name = br
    _state.logger = edge_node._setup_logger(f"pi_{br}")
    log = _state.logger

    log.info("Pi Edge API initializing for branch: %s", br.title())

    ucp_local, _ = edge_node.load_branch_data(br, log)
    _state.ucp_local = ucp_local

    X, y, feature_cols, scaler, _ = edge_node.preprocess(ucp_local, log)
    _state.feature_cols = feature_cols
    _state.scaler = scaler

    # Create Pi node and train lightweight model
    pi_node = PiEdgeNode(br, hq_url, api_key)
    model, metrics = pi_node.train_lightweight_model(X, y)
    _state.model   = model
    _state.metrics = metrics
    _state.pi_node = pi_node

    _state.ready = True
    log.info("Pi Edge API READY — %s (%d customers) Acc=%.4f F1=%.4f",
             br.title(), len(ucp_local), metrics.get("accuracy", 0), metrics.get("f1", 0))


# ═══════════════════════════════════════════════════════════
#  CLI
# ═══════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="SecureScore Pi Edge Node API")
    parser.add_argument("--branch",  default=os.getenv("BRANCH_NAME", DEFAULT_BRANCH_NAME))
    parser.add_argument("--port",    type=int, default=int(os.getenv("EDGE_PORT", str(DEFAULT_EDGE_PORT))))
    parser.add_argument("--host",    default="0.0.0.0")
    parser.add_argument("--hq-url",  default=os.getenv("HQ_URL", "http://127.0.0.1:5050"))
    parser.add_argument("--api-key", default=os.getenv("HQ_BRANCH_API_KEY", "changeme"))
    args = parser.parse_args()

    _init_pi_branch(args.branch, args.hq_url, args.api_key)

    logger.info("Starting Pi Edge API for %s on port %d", args.branch.title(), args.port)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
