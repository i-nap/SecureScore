"""
services/aggregation/main.py
============================
Aggregation microservice — FedAvg, Byzantine filter, DP, weight submission.
Port 5050.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

try:
    from observability.logging_config import setup_logging
    setup_logging(service_name="aggregation")
except ImportError:
    logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Aggregation service starting")
    yield
    logger.info("Aggregation service shutting down")


limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="SecureScore — Aggregation Service",
    version="1.0.0",
    description="FedAvg aggregation, Byzantine filter, DP noise, weight submission.",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

from .api import router  # noqa: E402
app.include_router(router)


@app.get("/api/health")
def health():
    from .fedavg import agg_state
    return {
        "status": "ok",
        "service": "aggregation",
        "current_round": agg_state.current_round,
        "active_version": agg_state.active_version,
        "submissions_this_round": len(agg_state.current_submissions),
    }


@app.get("/api/status")
def status():
    from .fedavg import agg_state
    from .config import ALL_BRANCHES, DP_EPSILON, MTLS_CA_CERT, MTLS_HQ_CERT, MTLS_HQ_KEY
    from pathlib import Path
    return {
        "current_round": agg_state.current_round,
        "active_version": agg_state.active_version,
        "submissions_this_round": list(agg_state.current_submissions.keys()),
        "submissions_count": len(agg_state.current_submissions),
        "global_model_ready": agg_state.global_model is not None,
        "model_versions": agg_state.list_model_versions(),
        "all_branches": ALL_BRANCHES,
        "min_nodes_required": agg_state.min_nodes,
        "anomaly_count": len(agg_state.anomaly_log),
        "dp_epsilon": DP_EPSILON,
    }
