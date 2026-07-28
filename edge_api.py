"""
edge_api.py — Edge Node REST API (UI-facing)
===============================================
FastAPI service that wraps edge_node.py functions as REST endpoints.
Each branch runs ONE instance of this service, serving:
  - Credit score lookup
  - SHAP XAI explanations
  - Customer list for branch managers
  - Localized robo-advisor
  - Fraud alert generation
  - Data drift analysis
  - Local model metrics

This is the service the BFF Gateway routes to.

Usage:
    python edge_api.py --branch kathmandu --port 7282
    python edge_api.py --branch sarlahi --port 7816
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

from fastapi import FastAPI, HTTPException, Query, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Import edge_node functions
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import edge_node

# ═══════════════════════════════════════════════════════════
#          STATE (per-branch, loaded at startup)
# ═══════════════════════════════════════════════════════════

class BranchState:
    def __init__(self):
        self.branch_name: str = ""
        self.model = None
        self.ucp_local: pd.DataFrame | None = None
        self.feature_cols: list = []
        self.scaler = None
        self.metrics: dict = {}
        self.logger = None
        self.ready = False
        self.hq_token: str | None = None  # cached HQ session token (refreshed on submit failure)

_state = BranchState()

logger = logging.getLogger("edge_api")

# ═══════════════════════════════════════════════════════════
#          FASTAPI APP
# ═══════════════════════════════════════════════════════════

app = FastAPI(title="SecureScore Edge API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ═══════════════════════════════════════════════════════════
#          MODELS
# ═══════════════════════════════════════════════════════════

class ExplainRequest(BaseModel):
    customer_id: str

class RoboAdviceRequest(BaseModel):
    profile: str = "balanced"
    amount: float = 1000000.0


class TransactionEvent(BaseModel):
    customer_id: str
    amount: float
    merchant: str = ""
    timestamp: str = ""
    channel: str = "wallet"
    is_international: bool = False
    location: str = ""
    payment_method: str = ""
    device: str = ""

# ═══════════════════════════════════════════════════════════
#  LOCALIZED ROBO-ADVISOR (Task 7)
# ═══════════════════════════════════════════════════════════

# Region-aware portfolio profiles
REGIONAL_PORTFOLIOS = {
    "urban": {
        "conservative": {
            "label": "Urban Conservative",
            "allocations": {
                "Nepal Govt Bonds": 0.30, "Fixed Deposits (Commercial Banks)": 0.25,
                "Blue-Chip NEPSE Stocks": 0.15, "Gold ETF/Physical Gold": 0.15,
                "Corporate Debentures": 0.10, "Cash Reserve": 0.05,
            },
            "expected_return": 0.085, "risk_level": "Low", "volatility": 0.04,
        },
        "balanced": {
            "label": "Urban Balanced",
            "allocations": {
                "NEPSE Index Fund": 0.25, "Blue-Chip Banking Stocks": 0.20,
                "Nepal Govt Bonds": 0.15, "Hydropower IPOs": 0.15,
                "Corporate Debentures": 0.10, "Insurance Endowment": 0.10,
                "Gold": 0.05,
            },
            "expected_return": 0.125, "risk_level": "Medium", "volatility": 0.12,
        },
        "aggressive": {
            "label": "Urban Growth",
            "allocations": {
                "Growth NEPSE Stocks": 0.30, "Hydropower/Energy Stocks": 0.20,
                "Microfinance Equities": 0.15, "Real Estate Fund": 0.10,
                "Mid-Cap NEPSE": 0.10, "International Mutual Fund": 0.10,
                "Crypto (NRB-compliant)": 0.05,
            },
            "expected_return": 0.175, "risk_level": "High", "volatility": 0.24,
        },
    },
    "semi_urban": {
        "conservative": {
            "label": "Regional Conservative",
            "allocations": {
                "Nepal Govt Bonds": 0.30, "Cooperative Fixed Deposits": 0.25,
                "Postal Savings": 0.15, "Gold/Silver": 0.15,
                "Commercial Bank FD": 0.10, "Cash Reserve": 0.05,
            },
            "expected_return": 0.075, "risk_level": "Low", "volatility": 0.03,
        },
        "balanced": {
            "label": "Regional Balanced",
            "allocations": {
                "Cooperative Shares": 0.25, "Nepal Govt Bonds": 0.20,
                "NEPSE Banking Stocks": 0.15, "Commercial Bank FD": 0.15,
                "Microfinance Shares": 0.10, "Gold": 0.10,
                "Insurance Endowment": 0.05,
            },
            "expected_return": 0.105, "risk_level": "Medium", "volatility": 0.09,
        },
        "aggressive": {
            "label": "Regional Growth",
            "allocations": {
                "NEPSE Growth Stocks": 0.25, "Microfinance Equities": 0.20,
                "Hydropower IPOs": 0.15, "Cooperative Shares": 0.15,
                "Real Estate (Local)": 0.10, "Mid-Cap NEPSE": 0.10,
                "Gold": 0.05,
            },
            "expected_return": 0.145, "risk_level": "High", "volatility": 0.18,
        },
    },
    "rural": {
        "conservative": {
            "label": "Agricultural Conservative",
            "allocations": {
                "Cooperative Fixed Deposits": 0.30, "Nepal Govt Bonds": 0.25,
                "Postal Savings Certificate": 0.20, "Gold/Silver (Physical)": 0.15,
                "Seasonal Agricultural Fund": 0.10,
            },
            "expected_return": 0.065, "risk_level": "Low", "volatility": 0.025,
        },
        "balanced": {
            "label": "Agricultural Balanced",
            "allocations": {
                "Agricultural Cooperative Shares": 0.25,
                "Nepal Govt Savings Bonds": 0.20,
                "Cooperative FD": 0.15, "Microfinance Shares": 0.15,
                "Seasonal Crop Insurance": 0.10, "Gold": 0.10,
                "Postal Savings": 0.05,
            },
            "expected_return": 0.085, "risk_level": "Medium", "volatility": 0.07,
        },
        "aggressive": {
            "label": "Agricultural Growth",
            "allocations": {
                "Microfinance Equities": 0.25, "Agricultural Cooperative Shares": 0.20,
                "Hydropower Community Shares": 0.15, "NEPSE Banking Stocks": 0.15,
                "Commercial Poultry/Fishery Fund": 0.10, "Cooperative FD": 0.10,
                "Gold": 0.05,
            },
            "expected_return": 0.115, "risk_level": "Medium-High", "volatility": 0.14,
        },
    },
}


def _monte_carlo(amount: float, annual_return: float, volatility: float,
                 months: int = 12, n_sim: int = 1000) -> dict:
    """Run Monte Carlo simulation for portfolio projection."""
    monthly_ret = annual_return / 12
    monthly_vol = volatility / (12 ** 0.5)
    rng = np.random.default_rng(42)

    sims = np.zeros((n_sim, months + 1))
    sims[:, 0] = amount
    for t in range(1, months + 1):
        rand = rng.normal(monthly_ret, monthly_vol, n_sim)
        sims[:, t] = sims[:, t - 1] * (1 + rand)

    final = sims[:, -1]
    return {
        "median_final": round(float(np.median(final)), 2),
        "p5": round(float(np.percentile(final, 5)), 2),
        "p25": round(float(np.percentile(final, 25)), 2),
        "p75": round(float(np.percentile(final, 75)), 2),
        "p95": round(float(np.percentile(final, 95)), 2),
        "prob_profit": round(float(np.mean(final > amount)), 4),
        "expected_return_pct": round(float((np.median(final) - amount) / amount * 100), 2),
        "monthly_path_median": [round(float(v), 2) for v in np.median(sims, axis=0)],
        "monthly_path_p10": [round(float(v), 2) for v in np.percentile(sims, 10, axis=0)],
        "monthly_path_p90": [round(float(v), 2) for v in np.percentile(sims, 90, axis=0)],
    }


# ═══════════════════════════════════════════════════════════
#  ENDPOINTS
# ═══════════════════════════════════════════════════════════

@app.get("/api/health")
def health():
    return {
        "status": "alive" if _state.ready else "initializing",
        "branch": _state.branch_name,
        "model_loaded": _state.model is not None,
        "customers_loaded": len(_state.ucp_local) if _state.ucp_local is not None else 0,
    }


@app.get("/api/metrics")
def get_metrics():
    """Local model accuracy, demographic breakdown, and data stats."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready yet")

    ucp = _state.ucp_local
    branch_type = edge_node.BRANCH_TYPE.get(_state.branch_name.title(), "unknown")

    # Demographics
    total = len(ucp)
    creditworthy = int((ucp.get("alternative_credit_score", pd.Series()) >= 600).sum()) if "alternative_credit_score" in ucp.columns else 0

    return {
        "branch": _state.branch_name.title(),
        "branch_type": branch_type,
        "model_metrics": _state.metrics,
        "data_stats": {
            "total_customers": total,
            "creditworthy": creditworthy,
            "not_creditworthy": total - creditworthy,
            "approval_rate": round(creditworthy / max(total, 1), 4),
        },
        "feature_count": len(_state.feature_cols),
        "model_config": edge_node.FEDERATED_MODEL_CONFIG,
    }


@app.get("/api/score")
def get_score(customer_id: str = Query(...)):
    """Get credit score for a single customer."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready yet")

    ucp = _state.ucp_local
    row = ucp[ucp["customer_id"] == customer_id]
    if row.empty:
        raise HTTPException(404, f"Customer {customer_id} not found in {_state.branch_name}")

    # Prepare features
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

    # Get raw UCP values for context
    r = row.iloc[0]
    return {
        "customer_id": customer_id,
        "prediction": "creditworthy" if pred == 1 else "not_creditworthy",
        "probability_creditworthy": round(float(prob[1]), 4),
        "probability_not_creditworthy": round(float(prob[0]), 4),
        "alt_credit_score": round(float(r.get("alternative_credit_score", 0)), 1),
        "monthly_income": round(float(r.get("monthly_income", 0)), 0),
        "branch": _state.branch_name.title(),
        "branch_type": edge_node.BRANCH_TYPE.get(_state.branch_name.title(), "unknown"),
    }


@app.post("/api/explain")
def explain(req: ExplainRequest):
    """SHAP-based XAI explanation for a customer."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready yet")

    result = edge_node.explain_customer(
        req.customer_id, _state.model, _state.ucp_local,
        _state.feature_cols, _state.scaler, _state.logger,
    )
    if result is None:
        raise HTTPException(404, f"Could not explain {req.customer_id}")
    return result


@app.get("/api/customers")
def list_customers(page: int = Query(1, ge=1), per_page: int = Query(25, ge=5, le=100)):
    """Paginated customer list for branch managers."""
    if not _state.ready:
        raise HTTPException(503, "Not ready")

    ucp = _state.ucp_local
    total = len(ucp)
    start = (page - 1) * per_page
    end = start + per_page
    subset = ucp.iloc[start:end]

    customers = []
    for _, r in subset.iterrows():
        customers.append({
            "customer_id": r.get("customer_id", ""),
            "alt_credit_score": round(float(r.get("alternative_credit_score", 0)), 1),
            "monthly_income": round(float(r.get("monthly_income", 0)), 0),
            "cibil_score": int(r.get("cibil_score", 0)),
            "dti": round(float(r.get("debt_to_income_ratio", 0)), 3),
        })

    return {
        "customers": customers,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
    }


@app.post("/api/robo_advice")
def robo_advice(req: RoboAdviceRequest):
    """Localized robo-advisor — suggests region-appropriate investments."""
    if not _state.ready:
        raise HTTPException(503, "Not ready")

    branch_type = edge_node.BRANCH_TYPE.get(_state.branch_name.title(), "urban")
    profiles = REGIONAL_PORTFOLIOS.get(branch_type, REGIONAL_PORTFOLIOS["urban"])
    profile = profiles.get(req.profile, profiles["balanced"])

    # Monte Carlo projection
    mc = _monte_carlo(req.amount, profile["expected_return"], profile["volatility"])

    return {
        "branch": _state.branch_name.title(),
        "branch_type": branch_type,
        "profile": profile["label"],
        "risk_level": profile["risk_level"],
        "allocations": profile["allocations"],
        "investment_amount": req.amount,
        "expected_annual_return": profile["expected_return"],
        "volatility": profile["volatility"],
        "projection": mc,
        "disclaimer": (
            "This is algorithmic advice based on regional economic data. "
            "Consult a licensed financial advisor before investing."
        ),
    }


@app.post("/api/fl_submit")
def fl_submit():
    """
    Participate in one federated round: serialize the already-trained local
    model (with DP noise), register with HQ, and submit the weights.
    Triggered by the HQ admin (via the BFF) — the branch's raw data never leaves.
    """
    if not _state.ready or _state.model is None:
        raise HTTPException(503, "Model not ready")

    hq_url = os.getenv("HQ_URL", "http://127.0.0.1:5050")
    log = _state.logger

    # Reuse the cached token (set on startup). HQ rate-limits /api/register to
    # 5/min, so only re-register when the cached token is missing or rejected.
    token = _state.hq_token or edge_node.register_with_hq(_state.branch_name, hq_url, log)
    if not token:
        raise HTTPException(502, "HQ registration failed (check HQ_BRANCH_API_KEY / HQ reachability)")
    _state.hq_token = token

    payload = edge_node.extract_weights(_state.model, log)
    metrics = dict(_state.metrics or {})
    metrics.setdefault("train_size", len(_state.ucp_local) if _state.ucp_local is not None else 0)

    sent = edge_node.send_weights_to_hq(
        _state.branch_name, payload, metrics, hq_url, log, token=token
    )
    if not sent:
        # Token may have expired — re-register once and retry.
        token = edge_node.register_with_hq(_state.branch_name, hq_url, log)
        _state.hq_token = token
        if token:
            sent = edge_node.send_weights_to_hq(
                _state.branch_name, payload, metrics, hq_url, log, token=token
            )
    if not sent:
        raise HTTPException(502, "HQ rejected the weight submission")

    return {
        "status": "submitted",
        "branch": _state.branch_name.title(),
        "f1": metrics.get("f1"),
        "train_size": metrics.get("train_size"),
        "dp_epsilon": payload.get("dp_epsilon"),
    }


@app.post("/api/ocr/cheque")
async def ocr_cheque(file: UploadFile = File(...)):
    """
    On-device cheque OCR. The image is processed at the branch (EasyOCR) and only
    the extracted fields are returned — the cheque image never leaves the branch.
    """
    if not _state.ready:
        raise HTTPException(503, "Not ready")
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "Image too large (max 8MB)")
    try:
        import cheque_ocr
        result = cheque_ocr.extract_cheque_fields(data)
    except Exception as exc:  # OCR is a best-effort boundary; never 500 the teller hard
        (_state.logger or logging.getLogger(__name__)).error("Cheque OCR failed: %s", exc)
        raise HTTPException(500, "OCR processing failed")
    result["branch"] = _state.branch_name.title()
    return result


@app.post("/api/ocr/handwriting")
async def ocr_handwriting(file: UploadFile = File(...)):
    """
    On-device handwriting digitisation (EasyOCR detect + TrOCR recognise). The
    image is processed at the branch — only the extracted text is returned.
    """
    if not _state.ready:
        raise HTTPException(503, "Not ready")
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "Image too large (max 8MB)")
    try:
        import handwriting_ocr
        result = handwriting_ocr.extract_handwriting(data)
    except Exception as exc:  # best-effort boundary; never hard-500 the teller
        (_state.logger or logging.getLogger(__name__)).error("Handwriting OCR failed: %s", exc)
        raise HTTPException(500, "OCR processing failed")
    result["branch"] = _state.branch_name.title()
    return result


@app.get("/api/fraud_alerts")
def fraud_alerts():
    """Detect anomalous customers using simple z-score on features."""
    if not _state.ready:
        raise HTTPException(503, "Not ready")

    ucp = _state.ucp_local
    alerts = []

    # Z-score anomaly on key financial metrics
    check_cols = ["debt_to_income_ratio", "credit_utilization", "dw_total_spent",
                  "monthly_income", "total_transaction_volume"]
    available = [c for c in check_cols if c in ucp.columns]

    for col in available:
        vals = ucp[col].dropna()
        if len(vals) < 10:
            continue
        mean, std = vals.mean(), vals.std()
        if std < 1e-6:
            continue
        z = (vals - mean) / std
        outliers = ucp.loc[z.abs() > 3]
        for _, row in outliers.iterrows():
            alerts.append({
                "customer_id": row.get("customer_id", "unknown"),
                "metric": col,
                "value": round(float(row[col]), 2),
                "z_score": round(float((row[col] - mean) / std), 2),
                "severity": "high" if abs((row[col] - mean) / std) > 4 else "medium",
                "detected_at": datetime.now(timezone.utc).isoformat(),
            })

    # Deduplicate by customer_id (keep highest severity)
    seen = {}
    for a in alerts:
        cid = a["customer_id"]
        if cid not in seen or a["severity"] == "high":
            seen[cid] = a
    unique_alerts = sorted(seen.values(), key=lambda x: abs(x["z_score"]), reverse=True)

    return {
        "branch": _state.branch_name.title(),
        "total_alerts": len(unique_alerts),
        "alerts": unique_alerts[:50],
    }


@app.get("/api/data_drift")
def data_drift():
    """Basic data drift analysis — compare feature distributions to expected ranges."""
    if not _state.ready:
        raise HTTPException(503, "Not ready")

    ucp = _state.ucp_local
    branch_type = edge_node.BRANCH_TYPE.get(_state.branch_name.title(), "urban")

    # Expected ranges per branch type
    expected = {
        "urban": {"monthly_income": (55000, 90000), "dw_transaction_count": (6, 40)},
        "semi_urban": {"monthly_income": (30000, 50000), "dw_transaction_count": (2, 22)},
        "rural": {"monthly_income": (18000, 32000), "dw_transaction_count": (1, 10)},
    }[branch_type]

    drift_report = []
    for feature, (low, high) in expected.items():
        if feature not in ucp.columns:
            continue
        vals = ucp[feature].dropna()
        actual_mean = float(vals.mean())
        actual_std = float(vals.std())
        pct_out = float(((vals < low) | (vals > high)).mean())

        drift_report.append({
            "feature": feature,
            "expected_range": [low, high],
            "actual_mean": round(actual_mean, 2),
            "actual_std": round(actual_std, 2),
            "pct_outside_range": round(pct_out * 100, 2),
            "drift_detected": pct_out > 0.15,
        })

    return {
        "branch": _state.branch_name.title(),
        "branch_type": branch_type,
        "features_checked": len(drift_report),
        "drift_report": drift_report,
    }


def _score_transaction(evt: TransactionEvent) -> tuple[float, str]:
    score = 0.0
    reason = "normal"
    if evt.amount >= 200_000:
        score += 0.5
        reason = "high_amount"
    elif evt.amount >= 50_000:
        score += 0.25
        reason = "elevated_amount"

    if evt.is_international:
        score += 0.2
        reason = "international"

    if evt.amount % 1000 == 0:
        score += 0.15
        reason = "round_amount"

    try:
        ts = evt.timestamp or ""
        if ts:
            hour = datetime.fromisoformat(ts.replace("Z", "")).hour
            if 0 <= hour <= 5:
                score += 0.1
                reason = "night_activity"
    except Exception:
        pass

    score = min(score, 1.0)
    return score, reason


@app.post("/api/transaction_ingest")
def transaction_ingest(evt: TransactionEvent):
    """Ingest a single transaction and emit a live fraud alert if needed."""
    if not _state.ready:
        raise HTTPException(503, "Not ready")

    score, reason = _score_transaction(evt)
    severity = "high" if score >= 0.7 else "medium" if score >= 0.45 else "low"

    alert = {
        "customer_id": evt.customer_id,
        "metric": "transaction_amount",
        "value": round(float(evt.amount), 2),
        "z_score": round(score * 5, 2),
        "severity": severity,
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "reason": reason,
        "merchant": evt.merchant,
        "channel": evt.channel,
        "is_international": evt.is_international,
    }

    _live_fraud_alerts.insert(0, alert)
    if len(_live_fraud_alerts) > 200:
        _live_fraud_alerts.pop()

    return {"status": "ok", "alert": alert, "scored": True}


# ═══════════════════════════════════════════════════════════
#          STARTUP: Train model & load data
# ═══════════════════════════════════════════════════════════

def _init_branch(branch_name: str):
    """Load data, train model, and populate state."""
    br = branch_name.lower().replace(" ", "_")
    _state.branch_name = br
    _state.logger = edge_node._setup_logger(br)

    log = _state.logger
    log.info("Edge API initializing for branch: %s", br.title())

    # Check for existing model
    model_path = os.path.join(edge_node.EDGE_STATE_DIR, f"model_{br}.json")
    meta_path = os.path.join(edge_node.EDGE_STATE_DIR, f"meta_{br}.json")

    # Always load data (needed for customer list, fraud alerts, etc.)
    ucp_local, tx_df = edge_node.load_branch_data(br, log)
    _state.ucp_local = ucp_local

    # Preprocess current data first so we know the live feature count
    X, y, feature_cols, scaler, _ = edge_node.preprocess(ucp_local, log)

    use_saved = False
    if os.path.isfile(model_path) and os.path.isfile(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
        saved_n = len(meta.get("feature_cols", []))
        if saved_n == X.shape[1]:
            use_saved = True
        else:
            log.warning(
                "Stale saved model has %d features but current data has %d — retraining",
                saved_n, X.shape[1],
            )
            os.remove(model_path)
            os.remove(meta_path)

    if use_saved:
        log.info("Loading existing model from %s", model_path)
        import xgboost as xgb
        from sklearn.preprocessing import StandardScaler
        model = xgb.XGBClassifier(**edge_node.FEDERATED_MODEL_CONFIG)
        model.load_model(model_path)

        _state.feature_cols = meta["feature_cols"]
        sc = StandardScaler()
        sc.mean_ = np.array(meta["scaler_mean"])
        sc.scale_ = np.array(meta["scaler_scale"])
        sc.n_features_in_ = len(_state.feature_cols)
        _state.scaler = sc
        _state.model = model

        # Eval using current preprocessed X (feature count matches)
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import accuracy_score, f1_score
        X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
        preds = model.predict(X_te)
        _state.metrics = {
            "accuracy": round(float(accuracy_score(y_te, preds)), 4),
            "f1": round(float(f1_score(y_te, preds, zero_division=0)), 4),
        }
        log.info("Loaded model OK — Acc=%.4f F1=%.4f", _state.metrics["accuracy"], _state.metrics["f1"])
    else:
        log.info("Training fresh model (%d features, %d samples)", X.shape[1], len(X))
        model, metrics = edge_node.train_local_model(X, y, log)
        _state.model = model
        _state.feature_cols = feature_cols
        _state.scaler = scaler
        _state.metrics = metrics

        # Save for future loads
        model.get_booster().save_model(model_path)
        with open(meta_path, "w") as f:
            json.dump({
                "feature_cols": feature_cols,
                "scaler_mean": scaler.mean_.tolist(),
                "scaler_scale": scaler.scale_.tolist(),
            }, f)
        log.info("Trained + saved — Acc=%.4f F1=%.4f", metrics.get("accuracy", 0), metrics.get("f1", 0))

    _state.ready = True
    log.info("Edge API READY for %s (%d customers)", br.title(), len(ucp_local))

    # Register with HQ so the HQ dashboard shows this branch as online
    hq_url = os.getenv("HQ_URL", "http://127.0.0.1:5050")
    hq_api_key = os.getenv("HQ_BRANCH_API_KEY", "")
    if hq_api_key:
        token = edge_node.register_with_hq(br.title(), hq_url, log)
        if token:
            _state.hq_token = token
            log.info("Registered with HQ at %s", hq_url)
        else:
            log.warning("Could not register with HQ — HQ dashboard may show branch as offline")

    # Initialize AI sub-models
    _init_ai_models()


# ═══════════════════════════════════════════════════════════
#          CLI
# ═══════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════
#  μGRAPHCODER ENDPOINTS
# ═══════════════════════════════════════════════════════════

from edge_node import (
    build_topology_graph, score_with_gnn, run_lora_adaptation,
    MU_GRAPH_AVAILABLE, MU_GRAPH_STATE_DIR,
)


class ChatRequest(BaseModel):
    customer_id: str
    message: str


# Credit factor → actionable advice mapping (rule-based counselor)
_FACTOR_ADVICE = {
    "credit_utilization": "Reduce your credit card balance to below 30% of your credit limit to improve your score.",
    "utilization": "Reducing credit utilization below 30% is one of the fastest ways to improve credit health.",
    "debt_to_income_ratio": "Lower your monthly debt obligations before applying for new credit facilities.",
    "dti": "Pay down existing loans to improve your debt-to-income ratio.",
    "tx_count": "Increase transaction frequency to build a stronger digital credit history.",
    "total_transaction_volume": "Maintaining consistent transaction activity demonstrates financial stability.",
    "digital_engagement_score": "Use mobile banking and digital payment services regularly to build your digital profile.",
    "income": "Demonstrating income growth through regular deposits strengthens your credit profile.",
    "alternative_credit_score": "Continue building your alternative credit history through consistent digital transactions.",
    "default": "Maintain on-time payments and keep credit utilization low for a stronger credit profile.",
}

_SCORE_BANDS = {
    "high_risk": (0.0, 0.4),
    "moderate": (0.4, 0.6),
    "fair": (0.6, 0.75),
    "good": (0.75, 1.0),
}

_RURAL_ADVICE = [
    "Consider joining a local cooperative society to build a formal credit history.",
    "Microfinance institutions like Grameen Bikas Bank offer products tailored to your region.",
    "Consistent eSewa/IME remittance history can strengthen your alternative credit profile.",
]
_URBAN_ADVICE = [
    "Consider a secured credit card to build credit history while limiting risk.",
    "Set up automatic payments to ensure timely bill settlement.",
    "Digital wallet activity on Khalti or eSewa contributes positively to your credit score.",
]


def _get_score_band(prob_default: float) -> str:
    for band, (lo, hi) in _SCORE_BANDS.items():
        if lo <= (1.0 - prob_default) <= hi:
            return band
    return "good"


def _credit_chat_response(customer_id: str, message: str, branch_name: str, ucp: "pd.DataFrame") -> dict:
    """Rule-based credit counselor using SHAP feature importance."""
    import pandas as pd

    msg_lower = message.lower()
    branch_type = "rural" if any(b in branch_name.lower() for b in ["sarlahi", "nepalgunj", "birgunj", "janakpur"]) \
                 else "urban" if any(b in branch_name.lower() for b in ["kathmandu", "lalitpur", "pokhara"]) \
                 else "semi_urban"

    # Fetch customer row
    cid_col = "customer_id" if "customer_id" in ucp.columns else ucp.columns[0]
    row = ucp[ucp[cid_col] == customer_id]
    if row.empty:
        return {"response": f"I couldn't find customer {customer_id} in our records.", "score_band": "unknown", "top_factors": [], "suggested_actions": []}

    row = row.iloc[0]

    # Compute simple score proxy
    alt_score = float(row.get("alternative_credit_score", row.get("alt_credit_score", 500)))
    prob_default = max(0.0, min(1.0, 1.0 - (alt_score - 300) / 850.0))
    score_band = _get_score_band(prob_default)

    # Identify top risk factors from available columns
    risk_factors = []
    if float(row.get("credit_utilization", row.get("utilization_rate", 0))) > 0.5:
        risk_factors.append("credit_utilization")
    if float(row.get("debt_to_income_ratio", row.get("dti_ratio", 0))) > 0.4:
        risk_factors.append("debt_to_income_ratio")
    if float(row.get("tx_count", row.get("transaction_count", 0))) < 5:
        risk_factors.append("tx_count")
    if float(row.get("digital_engagement_score", 50)) < 30:
        risk_factors.append("digital_engagement_score")
    if not risk_factors:
        risk_factors = ["default"]

    # Generate response based on intent
    if any(k in msg_lower for k in ["score", "why", "reason", "low", "explain"]):
        top = risk_factors[:3]
        advice = [_FACTOR_ADVICE.get(f, _FACTOR_ADVICE["default"]) for f in top]
        response = (
            f"Your credit score is in the **{score_band.replace('_', ' ')}** range. "
            f"The top factors affecting your score are: {', '.join(top)}. "
            f"{advice[0]}"
        )
        suggested = advice

    elif any(k in msg_lower for k in ["improve", "increase", "raise", "better", "boost"]):
        regional = _RURAL_ADVICE if branch_type == "rural" else _URBAN_ADVICE
        response = (
            f"To improve your credit score from the **{score_band.replace('_', ' ')}** level: "
            f"{_FACTOR_ADVICE.get(risk_factors[0], _FACTOR_ADVICE['default'])} "
            f"Additionally: {regional[0]}"
        )
        suggested = [_FACTOR_ADVICE.get(f, _FACTOR_ADVICE["default"]) for f in risk_factors[:2]] + [regional[0]]

    elif any(k in msg_lower for k in ["loan", "credit", "eligible", "qualify", "apply"]):
        if score_band == "good":
            response = "Based on your credit profile, you appear eligible for standard loan products. Visit your branch for a formal assessment."
        elif score_band == "fair":
            response = "You may qualify for smaller loan amounts. Improving your credit utilization ratio first could unlock better terms."
        else:
            response = f"Your current score suggests some risk factors need addressing before a loan application. {_FACTOR_ADVICE.get(risk_factors[0], _FACTOR_ADVICE['default'])}"
        suggested = [_FACTOR_ADVICE.get(f, _FACTOR_ADVICE["default"]) for f in risk_factors[:2]]

    elif any(k in msg_lower for k in ["utilization", "limit", "card"]):
        response = _FACTOR_ADVICE["credit_utilization"]
        suggested = [_FACTOR_ADVICE["credit_utilization"], _FACTOR_ADVICE["debt_to_income_ratio"]]

    elif any(k in msg_lower for k in ["payment", "history", "bill", "due"]):
        response = "Payment history is the most important factor. Setting up automatic payments ensures you never miss a due date."
        suggested = ["Set up standing instructions for loan EMIs.", "Enable SMS alerts for payment due dates."]

    else:
        response = (
            f"Your credit health is currently in the **{score_band.replace('_', ' ')}** range. "
            f"Your main area for improvement is: {_FACTOR_ADVICE.get(risk_factors[0], _FACTOR_ADVICE['default'])} "
            f"Feel free to ask me about your score, improvement tips, or loan eligibility."
        )
        suggested = [_FACTOR_ADVICE.get(f, _FACTOR_ADVICE["default"]) for f in risk_factors[:2]]

    return {
        "response": response,
        "score_band": score_band,
        "credit_score_estimate": round(alt_score, 0),
        "top_factors": risk_factors[:3],
        "suggested_actions": suggested[:3],
        "branch_type": branch_type,
    }


@app.post("/chat")
async def customer_chat(req: ChatRequest):
    """
    Rule-based credit counselor chatbot.
    Responds to customer questions about their credit score, improvement tips, and loan eligibility.
    """
    if not _state.ready or _state.ucp_local is None:
        raise HTTPException(status_code=503, detail="Branch not initialized")
    return _credit_chat_response(
        req.customer_id, req.message, _state.branch_name, _state.ucp_local
    )


@app.get("/topology_fingerprint")
async def topology_fingerprint():
    """
    Compute and return the current branch topology fingerprint.
    Returns fingerprint metadata and base64-encoded vector.
    """
    if not _state.ready or _state.ucp_local is None:
        raise HTTPException(status_code=503, detail="Branch not initialized")
    if not MU_GRAPH_AVAILABLE:
        return {"available": False, "reason": "mu_graph_coder package not installed"}

    graph_data = build_topology_graph(_state.ucp_local, None, _state.logger or logger)
    if graph_data is None:
        return {"available": False, "reason": "Graph construction failed"}

    return {
        "available": True,
        "branch": _state.branch_name,
        "fingerprint_b64": graph_data["fingerprint_b64"],
        "fingerprint_byte_size": graph_data["byte_size"],
        "under_512_bytes": graph_data["byte_size"] <= 512,
        "n_nodes": graph_data["n_nodes"],
        "n_edges": graph_data["n_edges"],
    }


@app.get("/gnn_score")
async def gnn_score(customer_id: str):
    """
    Return dual-engine credit score: XGBoost FL score + μGraphCoder GNN score.
    """
    if not _state.ready or _state.ucp_local is None:
        raise HTTPException(status_code=503, detail="Branch not initialized")

    # XGBoost score (existing path)
    xgb_score_data = None
    try:
        from edge_node import load_branch_data, preprocess
        cid_col = "customer_id" if "customer_id" in _state.ucp_local.columns else _state.ucp_local.columns[0]
        row = _state.ucp_local[_state.ucp_local[cid_col] == customer_id]
        if not row.empty and _state.model is not None:
            feat_row = row[_state.feature_cols].fillna(0)
            scaled = _state.scaler.transform(feat_row) if _state.scaler else feat_row.values
            prob = float(_state.model.predict_proba(scaled)[0][1])
            xgb_score_data = {
                "xgb_probability_default": round(prob, 4),
                "xgb_credit_score": round((1.0 - prob) * 850 + 300, 1),
            }
    except Exception as exc:
        logger.debug("XGBoost score failed: %s", exc)

    # GNN score (μGraphCoder path)
    gnn_data = None
    if MU_GRAPH_AVAILABLE:
        graph_data = build_topology_graph(_state.ucp_local, None, logger)
        gnn_data = score_with_gnn(customer_id, graph_data, _state.ucp_local, _state.branch_name, logger)

    if xgb_score_data is None and gnn_data is None:
        raise HTTPException(status_code=404, detail=f"Customer {customer_id} not found")

    return {
        "customer_id": customer_id,
        "branch": _state.branch_name,
        "xgboost": xgb_score_data,
        "mu_graphcoder_gnn": gnn_data,
        "dual_engine": xgb_score_data is not None and gnn_data is not None,
    }


@app.post("/adapt_drift")
async def adapt_drift():
    """
    Trigger on-device LoRA adaptation to recover from concept drift.
    Uses current branch data with at most 100 labeled samples.
    """
    if not _state.ready or _state.ucp_local is None:
        raise HTTPException(status_code=503, detail="Branch not initialized")
    if not MU_GRAPH_AVAILABLE:
        return {"available": False, "reason": "mu_graph_coder not installed"}

    graph_data = build_topology_graph(_state.ucp_local, None, logger)
    metrics = run_lora_adaptation(_state.branch_name, graph_data, _state.ucp_local, logger)
    return metrics


@app.get("/mu_graphcoder_status")
async def mu_graphcoder_status():
    """Return μGraphCoder availability and cached GNN status for this branch."""
    import os
    branch = _state.branch_name or "unknown"
    gnn_path = os.path.join(MU_GRAPH_STATE_DIR, f"gnn_{branch.lower()}.pt")
    adapted_path = os.path.join(MU_GRAPH_STATE_DIR, f"gnn_{branch.lower()}_adapted.pt")
    cfg_path = os.path.join(MU_GRAPH_STATE_DIR, f"gnn_config_{branch.lower()}.json")

    gnn_config = None
    if os.path.exists(cfg_path):
        import json
        with open(cfg_path) as f:
            gnn_config = json.load(f)

    return {
        "mu_graphcoder_available": MU_GRAPH_AVAILABLE,
        "branch": branch,
        "gnn_cached": os.path.exists(gnn_path),
        "adapted_gnn_cached": os.path.exists(adapted_path),
        "gnn_config": gnn_config,
        "fingerprint_dim": 44,
        "fingerprint_bytes": 176,
    }


# ═══════════════════════════════════════════════════════════
#  AI MODEL INSTANCES (lazy-initialized in _init_ai_models)
# ═══════════════════════════════════════════════════════════

_fraud_detector    = None
_loan_predictor    = None
_churn_predictor   = None
_aml_monitor       = None
_cashflow_forecaster = None
_risk_engine       = None


_ai_models_status: dict = {}   # populated by _init_ai_models for the status endpoint

# Live transaction alerts (for demo ingestion)
_live_fraud_alerts: list[dict] = []


def _init_ai_models():
    """Train all six AI sub-models on the branch UCP data."""
    global _fraud_detector, _loan_predictor, _churn_predictor
    global _aml_monitor, _cashflow_forecaster, _risk_engine

    if _state.ucp_local is None or len(_state.ucp_local) == 0:
        logger.warning("_init_ai_models: UCP not available, skipping")
        return

    ucp = _state.ucp_local
    log = _state.logger or logger

    try:
        from models.fraud_detection import FraudDetector
        fd = FraudDetector()
        metrics = fd.train(ucp)
        _fraud_detector = fd
        _ai_models_status["fraud_detection"] = {"status": "trained", **metrics}
        log.info("FraudDetector trained OK — flagged %d customers", metrics.get("n_flagged", 0))
    except Exception as exc:
        log.warning("FraudDetector init failed: %s", exc)
        _ai_models_status["fraud_detection"] = {"status": "failed", "error": str(exc)}

    try:
        from models.loan_default import LoanDefaultPredictor
        lp = LoanDefaultPredictor()
        metrics = lp.train(ucp)
        _loan_predictor = lp
        _ai_models_status["loan_default"] = {"status": "trained", **metrics}
        log.info("LoanDefaultPredictor trained OK — default_rate=%.1f%%", metrics.get("default_rate", 0)*100)
    except Exception as exc:
        log.warning("LoanDefaultPredictor init failed: %s", exc)
        _ai_models_status["loan_default"] = {"status": "failed", "error": str(exc)}

    try:
        from models.churn_predictor import ChurnPredictor
        cp = ChurnPredictor()
        metrics = cp.train(ucp)
        _churn_predictor = cp
        _ai_models_status["churn_predictor"] = {"status": "trained", **metrics}
        log.info("ChurnPredictor trained OK — churn_rate=%.1f%%", metrics.get("churn_rate", 0)*100)
    except Exception as exc:
        log.warning("ChurnPredictor init failed: %s", exc)
        _ai_models_status["churn_predictor"] = {"status": "failed", "error": str(exc)}

    try:
        from models.aml_monitor import AMLMonitor
        _aml_monitor = AMLMonitor()
        _ai_models_status["aml_monitor"] = {"status": "ready", "n_detectors": 3}
        log.info("AMLMonitor initialized OK")
    except Exception as exc:
        log.warning("AMLMonitor init failed: %s", exc)
        _ai_models_status["aml_monitor"] = {"status": "failed", "error": str(exc)}

    try:
        from models.cashflow_forecaster import CashFlowForecaster
        _cashflow_forecaster = CashFlowForecaster()
        _ai_models_status["cashflow_forecaster"] = {"status": "ready", "method": "ES+MA ensemble"}
        log.info("CashFlowForecaster initialized OK")
    except Exception as exc:
        log.warning("CashFlowForecaster init failed: %s", exc)
        _ai_models_status["cashflow_forecaster"] = {"status": "failed", "error": str(exc)}

    try:
        from models.unified_risk import UnifiedRiskEngine
        _risk_engine = UnifiedRiskEngine()
        _ai_models_status["unified_risk"] = {"status": "ready", "dimensions": 5}
        log.info("UnifiedRiskEngine initialized OK")
    except Exception as exc:
        log.warning("UnifiedRiskEngine init failed: %s", exc)
        _ai_models_status["unified_risk"] = {"status": "failed", "error": str(exc)}

    log.info("AI model initialization complete: %d/%d modules ready",
             sum(1 for v in _ai_models_status.values() if v.get("status") in ("trained", "ready")),
             len(_ai_models_status))


def _ensure_ai_models():
    """Lazy-init AI models on first use if startup init failed."""
    if any(v is None for v in [_fraud_detector, _loan_predictor, _churn_predictor,
                                _aml_monitor, _cashflow_forecaster, _risk_engine]):
        if _state.ready and _state.ucp_local is not None:
            _init_ai_models()


# ─── Pydantic models for AI endpoints ───────────────────────

class LoanApplicationRequest(BaseModel):
    loan_amount: float
    loan_tenure_months: int = 60
    monthly_income: float
    dti: float
    cibil_score: int
    credit_utilization: float = 0.3
    num_existing_loans: int = 0
    employment_type: str = "salaried"
    collateral_value: float = 0.0
    has_guarantor: bool = False
    digital_engagement: float = 50.0
    spending_consistency: float = 50.0


class FraudExplainRequest(BaseModel):
    customer_id: str


class CollateralEstimateRequest(BaseModel):
    asset_type: str = "land"
    location: str = "Kathmandu"
    area_sqft: float = 1200.0
    market_index: float = 1.0
    condition: str = "good"
    building_age: int = 8
    vehicle_type: str = "car"
    vehicle_age: int = 3


class RateOptimizerRequest(BaseModel):
    loan_type: str = "personal_loan"
    risk_grade: str = "C"
    market_rate: float = 14.5
    policy_floor: float = 7.0
    policy_ceil: float = 22.0
    dti: float = 0.35
    collateral_coverage: float = 0.35
    tenure_months: int = 60
    digital_score: float = 60.0
    priority: str = "balanced"


class RemittanceAnalyzeRequest(BaseModel):
    customer_id: str
    frequency: int = 4
    avg_amount: float = 45000.0
    channel: str = "bank"
    corridor: str = "India"
    sender_count: int = 1
    cashout_days: int = 4


COLLATERAL_LOCATION_RATE = {
    "Kathmandu": 12000,
    "Lalitpur": 10500,
    "Pokhara": 9000,
    "Bharatpur": 7500,
    "Biratnagar": 6800,
    "Butwal": 6200,
    "Janakpur": 5200,
    "Sarlahi": 4500,
}

COLLATERAL_CONDITION_MULT = {
    "excellent": 1.08,
    "good": 1.0,
    "fair": 0.9,
    "poor": 0.8,
}

COLLATERAL_VEHICLE_BASE = {
    "car": 2500000,
    "suv": 3500000,
    "bike": 200000,
    "truck": 4500000,
}

RATE_BASE = {
    "home_loan": 9.0,
    "business_loan": 12.0,
    "personal_loan": 16.0,
    "microfinance": 20.0,
    "agricultural": 8.0,
}

RATE_GRADE_ADJ = {
    "A": -1.1,
    "B": -0.6,
    "C": 0.0,
    "D": 1.2,
    "F": 2.6,
}


def _format_npr(value: float) -> str:
    if value >= 1_000_000:
        return f"NPR {value / 1_000_000:.2f}M"
    if value >= 1_000:
        return f"NPR {value / 1_000:.1f}K"
    return f"NPR {value:,.0f}"


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _hash_string(value: str) -> int:
    h = 2166136261
    for ch in value:
        h ^= ord(ch)
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) & 0xFFFFFFFF
    return h


def _lcg(seed: int):
    state = seed & 0xFFFFFFFF

    def _next() -> float:
        nonlocal state
        state = (1664525 * state + 1013904223) % 4294967296
        return state / 4294967296

    return _next


# ─── AI Models status endpoint ───────────────────────────────

@app.get("/api/ai_models/status")
def ai_models_status():
    """Training status and metrics for all 6 AI sub-models."""
    _ensure_ai_models()
    return {
        "branch":  _state.branch_name.title(),
        "n_customers": len(_state.ucp_local) if _state.ucp_local is not None else 0,
        "models":  _ai_models_status,
        "all_ready": all(
            v.get("status") in ("trained", "ready")
            for v in _ai_models_status.values()
        ),
    }


# ─── Fraud ML endpoints ──────────────────────────────────────

@app.get("/api/fraud_ml")
def fraud_ml(top_n: int = Query(20, ge=1, le=200)):
    """ML fraud detection: IsolationForest + XGBoost ensemble alerts."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready")
    _ensure_ai_models()
    if _fraud_detector is None:
        raise HTTPException(503, "FraudDetector not initialized")

    result_df = _fraud_detector.predict(_state.ucp_local)
    high = result_df[result_df["risk_level"] == "high"]
    medium = result_df[result_df["risk_level"] == "medium"]

    top = result_df.sort_values("ensemble_score", ascending=False).head(top_n)
    alerts = top.to_dict(orient="records")

    return {
        "branch": _state.branch_name.title(),
        "total_customers": len(result_df),
        "high_risk_count": len(high),
        "medium_risk_count": len(medium),
        "alerts": alerts,
    }


@app.post("/api/fraud_ml/explain")
def fraud_ml_explain(req: FraudExplainRequest):
    """SHAP explanation for a single customer's fraud score."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready")
    _ensure_ai_models()
    if _fraud_detector is None:
        raise HTTPException(503, "FraudDetector not initialized")

    result = _fraud_detector.explain(req.customer_id, _state.ucp_local)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result


# ─── Loan default endpoints ──────────────────────────────────

@app.post("/api/loan_default")
def loan_default(req: LoanApplicationRequest):
    """Predict loan default probability for a new application."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready")
    _ensure_ai_models()
    if _loan_predictor is None:
        raise HTTPException(503, "LoanDefaultPredictor not initialized")

    result = _loan_predictor.predict_default_risk(
        loan_amount=req.loan_amount,
        loan_tenure_months=req.loan_tenure_months,
        monthly_income=req.monthly_income,
        dti=req.dti,
        cibil_score=req.cibil_score,
        credit_utilization=req.credit_utilization,
        num_existing_loans=req.num_existing_loans,
        employment_type=req.employment_type,
        collateral_value=req.collateral_value,
        has_guarantor=req.has_guarantor,
        digital_engagement=req.digital_engagement,
        spending_consistency=req.spending_consistency,
    )
    if "error" in result:
        raise HTTPException(503, result["error"])
    return result


@app.get("/api/loan_default/portfolio")
def loan_portfolio():
    """Branch-level loan portfolio risk grade distribution."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready")
    _ensure_ai_models()
    if _loan_predictor is None:
        raise HTTPException(503, "LoanDefaultPredictor not initialized")

    result = _loan_predictor.portfolio_risk_summary(_state.ucp_local)
    if "error" in result:
        raise HTTPException(503, result["error"])
    result["branch"] = _state.branch_name.title()
    return result


# ─── Churn endpoints ─────────────────────────────────────────

@app.get("/api/churn/{customer_id}")
def churn_customer(customer_id: str):
    """30-day churn probability for a single customer."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready")
    _ensure_ai_models()
    if _churn_predictor is None:
        raise HTTPException(503, "ChurnPredictor not initialized")

    result = _churn_predictor.predict_churn_probability(customer_id, _state.ucp_local)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result


@app.get("/api/churn_summary")
def churn_summary():
    """Branch-level churn risk distribution and top at-risk customers."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready")
    _ensure_ai_models()
    if _churn_predictor is None:
        raise HTTPException(503, "ChurnPredictor not initialized")

    result = _churn_predictor.branch_churn_summary(_state.ucp_local)
    if "error" in result:
        raise HTTPException(503, result["error"])
    result["branch"] = _state.branch_name.title()
    return result


# ─── AML endpoints ───────────────────────────────────────────

@app.get("/api/aml_scan")
def aml_scan():
    """Full AML scan: structuring + round amounts + behavioral anomalies."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready")
    _ensure_ai_models()
    if _aml_monitor is None:
        raise HTTPException(503, "AMLMonitor not initialized")

    result = _aml_monitor.full_aml_scan(_state.ucp_local)
    result["branch"] = _state.branch_name.title()
    return result


@app.get("/api/aml_sar/{customer_id}")
def aml_sar(customer_id: str):
    """Generate NRB-compliant Suspicious Activity Report for a customer."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready")
    _ensure_ai_models()
    if _aml_monitor is None:
        raise HTTPException(503, "AMLMonitor not initialized")

    result = _aml_monitor.generate_sar_summary(customer_id, _state.ucp_local)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result


# ─── Collateral estimator ──────────────────────────────────

@app.post("/api/collateral_estimate")
def collateral_estimate(req: CollateralEstimateRequest):
    if not _state.ready:
        raise HTTPException(503, "Model not ready")

    notes: list[str] = []
    location_rate = COLLATERAL_LOCATION_RATE.get(req.location, 6000)
    market = min(max(req.market_index, 0.7), 1.3)
    condition_mult = COLLATERAL_CONDITION_MULT.get(req.condition, 1.0)

    base_value = 0.0
    depreciation = 1.0
    liquidity = 1.0

    if req.asset_type == "land":
        base_value = req.area_sqft * location_rate
        if req.area_sqft < 500:
            notes.append("Small plot size can reduce liquidity.")
    elif req.asset_type == "building":
        base_value = req.area_sqft * location_rate * 1.35
        depreciation = 1 - min(req.building_age * 0.01, 0.35)
        if req.building_age > 20:
            notes.append("Older buildings require deeper due diligence.")
    elif req.asset_type == "vehicle":
        base_value = COLLATERAL_VEHICLE_BASE.get(req.vehicle_type, 200000)
        depreciation = max(0.4, 1 - req.vehicle_age * 0.08)
        liquidity = 0.9
        if req.vehicle_age > 5:
            notes.append("Vehicle age reduces resale value.")
    else:
        base_value = req.area_sqft * location_rate

    if req.market_index > 1.15 or req.market_index < 0.85:
        notes.append("Market index is outside normal range.")

    adjusted = base_value * market * condition_mult * depreciation * liquidity
    range_low = adjusted * 0.9
    range_high = adjusted * 1.1
    max_ltv = adjusted * 0.7

    confidence = 82 if req.asset_type == "building" else 78 if req.asset_type == "land" else 70
    if req.market_index > 1.15 or req.market_index < 0.85:
        confidence -= 6
    if req.condition == "excellent":
        confidence += 4
    if req.condition == "poor":
        confidence -= 6
    confidence = max(50, min(95, confidence))
    confidence_label = "High" if confidence >= 80 else "Medium" if confidence >= 65 else "Low"

    breakdown = [
        {"label": "Base value", "value": _format_npr(base_value)},
        {"label": "Market index", "value": f"{market:.2f}x"},
        {"label": "Condition factor", "value": f"{condition_mult:.2f}x"},
    ]

    if req.asset_type == "building":
        breakdown.append({"label": "Age factor", "value": f"{depreciation:.2f}x"})
    if req.asset_type == "vehicle":
        breakdown.append({"label": "Depreciation", "value": f"{depreciation:.2f}x"})
        breakdown.append({"label": "Liquidity factor", "value": f"{liquidity:.2f}x"})

    return {
        "asset_type": req.asset_type,
        "location": req.location,
        "adjusted_value": round(float(adjusted), 2),
        "range_low": round(float(range_low), 2),
        "range_high": round(float(range_high), 2),
        "max_ltv": round(float(max_ltv), 2),
        "confidence": round(float(confidence), 2),
        "confidence_label": confidence_label,
        "location_rate": location_rate,
        "breakdown": breakdown,
        "notes": notes,
    }


# ─── Rate optimizer ───────────────────────────────────────

@app.post("/api/rate_optimizer")
def rate_optimizer(req: RateOptimizerRequest):
    if not _state.ready:
        raise HTTPException(503, "Model not ready")

    base_rate = RATE_BASE.get(req.loan_type, 12.0)
    grade_adj = RATE_GRADE_ADJ.get(req.risk_grade.upper(), 0.0)

    dti_adj = 0.0
    if req.dti >= 0.6:
        dti_adj = 1.2
    elif req.dti >= 0.45:
        dti_adj = 0.6

    collateral_adj = 0.0
    if req.collateral_coverage >= 0.6:
        collateral_adj = -0.6
    elif req.collateral_coverage >= 0.3:
        collateral_adj = -0.2

    tenure_adj = 0.3 if req.tenure_months >= 84 else 0.15 if req.tenure_months >= 60 else 0.0
    digital_adj = -0.2 if req.digital_score >= 75 else 0.2 if req.digital_score <= 35 else 0.0

    model_rate = base_rate + grade_adj + dti_adj + collateral_adj + tenure_adj + digital_adj
    blended = model_rate * 0.6 + req.market_rate * 0.4

    if req.priority == "growth":
        priority_adj = -0.3
    elif req.priority == "margin":
        priority_adj = 0.4
    else:
        priority_adj = 0.0

    recommended = _clamp(blended + priority_adj, req.policy_floor, req.policy_ceil)
    band_low = _clamp(recommended - 0.8, req.policy_floor, req.policy_ceil)
    band_high = _clamp(recommended + 0.8, req.policy_floor, req.policy_ceil)
    delta = recommended - req.market_rate

    notes: list[str] = []
    if grade_adj > 0:
        notes.append("Risk grade increases base rate.")
    if grade_adj < 0:
        notes.append("Risk grade supports a lower rate.")
    if dti_adj > 0:
        notes.append("High DTI pushes rate upward.")
    if collateral_adj < 0:
        notes.append("Collateral coverage reduces rate.")
    if digital_adj < 0:
        notes.append("Strong digital engagement improves pricing.")
    if req.priority == "growth":
        notes.append("Growth priority applied.")
    if req.priority == "margin":
        notes.append("Margin priority applied.")

    return {
        "base_rate": round(float(base_rate), 4),
        "model_rate": round(float(model_rate), 4),
        "recommended_rate": round(float(recommended), 4),
        "band_low": round(float(band_low), 4),
        "band_high": round(float(band_high), 4),
        "delta_vs_market": round(float(delta), 4),
        "notes": notes,
    }


# ─── Remittance analyzer ──────────────────────────────────

@app.post("/api/remittance_analyze")
def remittance_analyze(req: RemittanceAnalyzeRequest):
    if not _state.ready:
        raise HTTPException(503, "Model not ready")

    flags: list[str] = []
    risk = 5 if req.frequency == 0 else 15

    if req.channel == "hundi":
        risk += 30
        flags.append("Hundi channel detected")
    elif req.channel == "cash":
        risk += 20
        flags.append("Cash payout channel")
    elif req.channel == "digital":
        risk += 6

    if req.frequency >= 8:
        risk += 10
        flags.append("High frequency remittances")
    elif req.frequency > 0 and req.frequency <= 1:
        risk += 8
        flags.append("Irregular remittance cadence")

    if req.avg_amount >= 500000:
        risk += 12
        flags.append("Large remittance value")
    elif req.avg_amount >= 200000:
        risk += 6

    if req.sender_count >= 4:
        risk += 10
        flags.append("Multiple senders involved")
    elif req.sender_count >= 2:
        risk += 4

    if req.cashout_days <= 2:
        risk += 12
        flags.append("Fast cash-out behavior")
    elif req.cashout_days <= 5:
        risk += 6

    if req.corridor == "Gulf":
        risk += 6
    if req.corridor == "Other":
        risk += 5
    if req.corridor == "India":
        risk -= 3

    if req.frequency == 0:
        flags.append("No remittance activity")

    risk = max(0, min(100, risk))
    severity = "High" if risk >= 70 else "Medium" if risk >= 40 else "Low"
    if risk >= 70:
        action = "Escalate for SAR review"
    elif risk >= 40:
        action = "Monitor and request documents"
    else:
        action = "Clear with routine monitoring"

    base_monthly = req.avg_amount * max(req.frequency, 0)
    seed = _hash_string(req.customer_id or "seed")
    rnd = _lcg(seed)

    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    now = datetime.now(timezone.utc)
    labels = []
    for i in range(6):
        idx = (now.month - (5 - i) - 1 + 12) % 12
        labels.append(month_names[idx])

    series = []
    for label in labels:
        noise = (rnd() - 0.5) * 0.3
        total = max(0, base_monthly * (1 + noise))
        series.append({"month": label, "total": round(float(total), 0)})

    avg = sum(s["total"] for s in series) / max(len(series), 1)
    peak = max((s["total"] for s in series), default=0)
    spike_ratio = peak / avg if avg > 0 else 0
    if spike_ratio >= 1.6:
        flags.append("Spike above recent average")

    return {
        "risk_score": round(float(risk), 2),
        "severity": severity,
        "action": action,
        "flags": flags,
        "series": series,
        "avg_monthly": round(float(avg), 2),
        "peak_monthly": round(float(peak), 2),
        "base_monthly": round(float(base_monthly), 2),
    }


# ─── Cash flow endpoints ─────────────────────────────────────

@app.get("/api/cashflow/{customer_id}")
def cashflow_customer(customer_id: str):
    """3-month cash flow forecast for a single customer."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready")
    _ensure_ai_models()
    if _cashflow_forecaster is None:
        raise HTTPException(503, "CashFlowForecaster not initialized")

    branch = _state.branch_name.title()
    result = _cashflow_forecaster.forecast_customer(customer_id, _state.ucp_local, branch)
    return result


@app.get("/api/cashflow/branch/aggregate")
def cashflow_branch():
    """Aggregate 3-month cash flow forecast across all branch customers."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready")
    _ensure_ai_models()
    if _cashflow_forecaster is None:
        raise HTTPException(503, "CashFlowForecaster not initialized")

    branch = _state.branch_name.title()
    result = _cashflow_forecaster.branch_aggregate_forecast(_state.ucp_local, branch)
    return result


# ─── Unified risk endpoints ───────────────────────────────────

@app.get("/api/unified_risk/{customer_id}")
def unified_risk_customer(customer_id: str):
    """Full 5-dimension unified risk profile for a single customer."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready")
    _ensure_ai_models()
    if _risk_engine is None:
        raise HTTPException(503, "UnifiedRiskEngine not initialized")

    branch = _state.branch_name.title()
    result = _risk_engine.score_customer(
        customer_id=customer_id,
        ucp=_state.ucp_local,
        fraud_detector=_fraud_detector,
        churn_predictor=_churn_predictor,
        aml_monitor=_aml_monitor,
        cashflow_forecaster=_cashflow_forecaster,
        branch=branch,
    )
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result


@app.get("/api/unified_risk/branch/distribution")
def unified_risk_distribution():
    """Composite risk score histogram and grade distribution for entire branch."""
    if not _state.ready:
        raise HTTPException(503, "Model not ready")
    _ensure_ai_models()
    if _risk_engine is None:
        raise HTTPException(503, "UnifiedRiskEngine not initialized")

    result = _risk_engine.branch_risk_distribution(
        ucp=_state.ucp_local,
        fraud_detector=_fraud_detector,
        churn_predictor=_churn_predictor,
        aml_monitor=_aml_monitor,
    )
    result["branch"] = _state.branch_name.title()
    return result


def main():
    parser = argparse.ArgumentParser(description="SecureScore Edge Node API")
    parser.add_argument("--branch", required=True, help="Branch name (e.g. kathmandu)")
    parser.add_argument("--port", type=int, default=0, help="Port (default: auto from branch hash)")
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    branch = args.branch.lower().replace(" ", "_")
    port = args.port or (7000 + hash(branch) % 1000)

    # Initialize branch data + model
    _init_branch(branch)

    logger.info("Starting Edge API for %s on port %d", branch.title(), port)
    uvicorn.run(app, host=args.host, port=port, log_level="info")


if __name__ == "__main__":
    main()
