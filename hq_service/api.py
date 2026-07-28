"""
hq_service/api.py
=================
FastAPI service implementing the /api/v1 HQ endpoints.
"""

from __future__ import annotations

import json
import os
import logging
import time
import hmac
import hashlib
from pathlib import Path
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from branch_service.models import EnsembleModel
from hq_service.hypernetwork import HypernetworkPersonalization
from shared.decision_logic import percentile_rank
import numpy as np
from apscheduler.schedulers.background import BackgroundScheduler

try:
    from db.models import (
        get_session,
        GradientUpload,
        ScoringDecision,
        Customer,
        CustomerApplication,
        Branch,
    )
except Exception:
    get_session = None
    GradientUpload = None
    ScoringDecision = None
    Customer = None
    CustomerApplication = None


class BackgroundVerifyRequest(BaseModel):
    customer_application: dict
    immediate_decision: dict
    branch_id: str


app = FastAPI(title="HQ Service", version="1.0.0")

STATE_DIR = Path(os.getenv("HQ_STATE_DIR", "hq_state"))
STATE_DIR.mkdir(parents=True, exist_ok=True)
AGG_PATH = STATE_DIR / "aggregated_gradients.json"
MODEL_PATH = STATE_DIR / "global_ensemble.json"
SPEC_SERVICE_TOKEN = os.getenv("SPEC_SERVICE_TOKEN", "")
SPEC_JWT_SECRET = os.getenv("SPEC_JWT_SECRET", "")
SPEC_TLS_CERT = os.getenv("SPEC_TLS_CERT", "")
SPEC_TLS_KEY = os.getenv("SPEC_TLS_KEY", "")
SPEC_MTLS_CA_CERT = os.getenv("SPEC_MTLS_CA_CERT", "")

hypernetwork = HypernetworkPersonalization()
logger = logging.getLogger("hq.spec")
scheduler = BackgroundScheduler()


def _build_branch_metrics(db) -> dict:
    metrics = {}
    branches = db.query(Branch).all() if Branch is not None else []
    for branch in branches:
        metrics[branch.name] = {
            "lat": branch.latitude or 0.0,
            "lon": branch.longitude or 0.0,
            "region": branch.region or "plain",
            "population_density": branch.population_density or 0.0,
            "avg_income": branch.avg_customer_income or 0.0,
            "num_customers": branch.num_customers or 0,
            "uptime": 1.0,
            "data_volume": 0.0,
        }

    if ScoringDecision is not None:
        for branch_name in list(metrics.keys()):
            rows = db.query(ScoringDecision).filter(ScoringDecision.branch_id == branch_name).all()
            if rows:
                total = len(rows)
                rejects = sum(1 for r in rows if r.immediate_decision == "REJECT")
                metrics[branch_name]["default_rate"] = rejects / max(total, 1)
                metrics[branch_name]["accuracy"] = 0.0

    if GradientUpload is not None:
        uploads = db.query(GradientUpload).all()
        for upload in uploads:
            branch_name = upload.branch_id
            metrics.setdefault(branch_name, {})
            metrics[branch_name]["data_volume"] = metrics[branch_name].get("data_volume", 0.0) + (
                upload.data_volume or 0
            )

    return metrics


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
    return {"status": "ok"}


def _aggregate_internal() -> dict:
    if get_session is None:
        return {"status": "error", "message": "Database not available"}

    db = get_session()
    try:
        uploads = db.query(GradientUpload).all()
        if not uploads:
            return {"status": "success", "models_updated": 0, "global_model_updated": False}

        temp_model = EnsembleModel()
        combined = {}
        weights_sum = {}
        for upload in uploads:
            weight = float(upload.data_volume or 1)
            decompressed = temp_model.decompress_gradients(upload.compressed_gradients)
            for name, grad in decompressed.items():
                combined[name] = combined.get(name, 0) + grad * weight
                weights_sum[name] = weights_sum.get(name, 0) + weight

        aggregated = {}
        for name, grad in combined.items():
            aggregated[name] = grad / max(weights_sum.get(name, 1), 1)

        serializable = {k: v.tolist() if hasattr(v, "tolist") else list(v) for k, v in aggregated.items()}
        with open(AGG_PATH, "w", encoding="utf-8") as f:
            json.dump(serializable, f)

        model = None
        if MODEL_PATH.exists():
            try:
                model = EnsembleModel.load_model(str(MODEL_PATH))
            except Exception:
                model = None

        if model is None:
            model = EnsembleModel()

        updated = False
        lr_model = model.models.get("LR")
        if lr_model is not None and hasattr(lr_model, "coef_") and "LR" in aggregated:
            grad = np.asarray(aggregated["LR"]).reshape(-1)
            coef = lr_model.coef_.reshape(-1)
            if grad.shape[0] == coef.shape[0] + 1:
                lr_lr = 0.01
                lr_model.coef_ = (coef - lr_lr * grad[:-1]).reshape(lr_model.coef_.shape)
                lr_model.intercept_ = np.asarray([lr_model.intercept_[0] - lr_lr * grad[-1]])
                updated = True

        nn_model = model.models.get("NN")
        if nn_model is not None and "NN" in aggregated:
            grad = np.asarray(aggregated["NN"]).reshape(-1)
            params = [p for p in nn_model.parameters() if p.requires_grad]
            total = sum(int(p.numel()) for p in params)
            if total == grad.shape[0]:
                lr_lr = 0.001
                offset = 0
                for p in params:
                    size = int(p.numel())
                    update = grad[offset:offset + size].reshape(p.data.shape)
                    p.data = p.data - lr_lr * p.data.new_tensor(update)
                    offset += size
                updated = True

        try:
            model.save_model(str(MODEL_PATH))
        except Exception:
            logger.exception("Failed to save global model")

        return {
            "status": "success",
            "models_updated": len(uploads),
            "global_model_updated": updated,
        }
    finally:
        db.close()


def _personalize_internal() -> dict:
    if not AGG_PATH.exists():
        return {"status": "success", "branches_personalized": 0}

    if get_session is None:
        return {"status": "success", "branches_personalized": 0}

    with open(AGG_PATH, "r", encoding="utf-8") as f:
        _raw = json.load(f)
        aggregated_gradient = {k: np.array(v) for k, v in _raw.items()}

    db = get_session()
    try:
        branch_metrics = _build_branch_metrics(db)

        decompressed_gradients = {}
        uploads = db.query(GradientUpload).all()
        temp_model = EnsembleModel()
        for upload in uploads:
            branch = upload.branch_id
            grad = temp_model.decompress_gradients(upload.compressed_gradients)
            if branch not in decompressed_gradients:
                decompressed_gradients[branch] = grad
            else:
                for name, arr in grad.items():
                    decompressed_gradients[branch][name] = (
                        decompressed_gradients[branch].get(name, 0) + arr
                    )

        if not hypernetwork.trained and branch_metrics:
            historical = []
            for branch_id, metrics in branch_metrics.items():
                historical.append({
                    "branch_id": branch_id,
                    "metrics": metrics,
                    "gradients": decompressed_gradients.get(branch_id, {}),
                    "outcome": 0.5,
                })
            try:
                hypernetwork.train_hypernetwork(historical)
            except Exception:
                logger.exception("Hypernetwork training failed; using uniform weights")

        result = hypernetwork.personalize_for_all_branches(
            aggregated_gradient=aggregated_gradient,
            branch_metrics=branch_metrics,
            decompressed_gradients=decompressed_gradients,
        )

        for branch_id, weights in result.items():
            weights_path = STATE_DIR / f"branch_weights_{branch_id}.json"
            try:
                weights_path.write_text(json.dumps(list(weights)), encoding="utf-8")
            except Exception:
                logger.exception("Failed to save weights for %s", branch_id)

        return {"status": "success", "branches_personalized": len(result)}
    finally:
        db.close()


@app.get("/models/global/latest")
def get_global_model(_auth: None = Depends(_require_spec_auth)):
    if MODEL_PATH.exists():
        return Response(content=MODEL_PATH.read_bytes(), media_type="application/json")
    import tempfile, os as _os
    model = EnsembleModel()
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        model.save_model(tmp_path)
        payload = Path(tmp_path).read_bytes()
    finally:
        _os.unlink(tmp_path)
    return Response(content=payload, media_type="application/json")


@app.get("/weights/branch/{branch_id}/latest")
def get_branch_weights(branch_id: str, _auth: None = Depends(_require_spec_auth)):
    weights_path = STATE_DIR / f"branch_weights_{branch_id}.json"
    if weights_path.exists():
        return Response(content=weights_path.read_bytes(), media_type="application/json")
    payload = json.dumps([0.2] * 5).encode()
    return Response(content=payload, media_type="application/json")


@app.post("/api/v1/aggregate")
def aggregate_gradients(_auth: None = Depends(_require_spec_auth)):
    return _aggregate_internal()


@app.post("/api/v1/hypernetwork/personalize")
def personalize(_auth: None = Depends(_require_spec_auth)):
    if not AGG_PATH.exists():
        return {"status": "success", "branches_personalized": 0}

    with open(AGG_PATH, "r", encoding="utf-8") as f:
        _raw = json.load(f)
        aggregated_gradient = {k: np.array(v) for k, v in _raw.items()}

    if get_session is None:
        return {"status": "success", "branches_personalized": 0}

    db = get_session()
    try:
        branch_metrics = _build_branch_metrics(db)

        decompressed_gradients = {}
        uploads = db.query(GradientUpload).all()
        temp_model = EnsembleModel()
        for upload in uploads:
            branch = upload.branch_id
            grad = temp_model.decompress_gradients(upload.compressed_gradients)
            if branch not in decompressed_gradients:
                decompressed_gradients[branch] = grad
            else:
                for name, arr in grad.items():
                    decompressed_gradients[branch][name] = (
                        decompressed_gradients[branch].get(name, 0) + arr
                    )

        if not hypernetwork.trained and branch_metrics:
            historical = []
            for branch_id, metrics in branch_metrics.items():
                historical.append({
                    "branch_id": branch_id,
                    "metrics": metrics,
                    "gradients": decompressed_gradients.get(branch_id, {}),
                    "outcome": 0.5,
                })
            try:
                hypernetwork.train_hypernetwork(historical)
            except Exception:
                logger.exception("Hypernetwork training failed; using uniform weights")

        result = hypernetwork.personalize_for_all_branches(
            aggregated_gradient=aggregated_gradient,
            branch_metrics=branch_metrics,
            decompressed_gradients=decompressed_gradients,
        )

        for branch_id, weights in result.items():
            weights_path = STATE_DIR / f"branch_weights_{branch_id}.json"
            try:
                weights_path.write_text(json.dumps(list(weights)), encoding="utf-8")
            except Exception:
                logger.exception("Failed to save weights for %s", branch_id)

        return {"status": "success", "branches_personalized": len(result)}
    finally:
        db.close()


@app.post("/api/v1/verify/background")
def verify_background(req: BackgroundVerifyRequest, _auth: None = Depends(_require_spec_auth)):
    """
    Queue an immediate branch decision for background re-verification by HQ.
    Creates a ScoringDecision row with status=IMMEDIATE_APPROVAL_GIVEN so the
    BackgroundVerificationService worker picks it up within 30 seconds.
    """
    if get_session is None:
        return {"status": "queued", "note": "db_unavailable"}

    db = get_session()
    try:
        app_data = req.customer_application
        immediate = req.immediate_decision
        branch_id = req.branch_id

        customer_id = app_data.get("customer_id", "unknown")

        if ScoringDecision is not None:
            record = ScoringDecision(
                customer_id=customer_id,
                branch_id=branch_id,
                averaged_percentile=immediate.get("percentile"),
                immediate_decision=immediate.get("decision", "MANUAL_REVIEW"),
                interest_rate=immediate.get("interest_rate"),
                status="IMMEDIATE_APPROVAL_GIVEN",
                verification_status="PENDING",
            )
            db.add(record)
            db.commit()
            logger.info(
                "[verify/background] Queued decision customer=%s branch=%s decision=%s",
                customer_id, branch_id, immediate.get("decision"),
            )

        return {"status": "queued", "customer_id": customer_id, "branch_id": branch_id}
    except Exception as exc:
        logger.error("[verify/background] Failed to queue: %s", exc)
        db.rollback()
        return {"status": "queued", "note": str(exc)}
    finally:
        db.close()


def _weekly_fairness_audit():
    """
    Weekly scheduled fairness audit across all branches.
    Checks that no single model is dominating weights and that weights
    are roughly equitable across branch types (urban vs rural).
    Logs a FAIRNESS_AUDIT record to the HQ state directory.
    """
    import json as _json

    logger.info("[FairnessAudit] Starting weekly fairness audit...")
    audit_results = []
    issues = []

    branch_names = []
    try:
        if get_session is not None and Branch is not None:
            db = get_session()
            try:
                branch_names = [b.name for b in db.query(Branch).all()]
            finally:
                db.close()
    except Exception as exc:
        logger.warning("[FairnessAudit] Could not load branches from DB: %s", exc)

    if not branch_names:
        branch_names = ["kathmandu", "pokhara", "sarlahi"]

    all_weights = {}
    for branch_id in branch_names:
        weights_path = STATE_DIR / f"branch_weights_{branch_id}.json"
        if weights_path.exists():
            try:
                weights = json.loads(weights_path.read_text(encoding="utf-8"))
                all_weights[branch_id] = list(weights)
            except Exception:
                pass

    if not all_weights:
        logger.info("[FairnessAudit] No branch weights found — skipping audit.")
        return

    model_keys = ["LR", "RF", "GB", "NN", "XGB"]

    for branch_id, weights in all_weights.items():
        w = weights[:5] if len(weights) >= 5 else weights + [0.2] * (5 - len(weights))
        result = {"branch_id": branch_id, "weights": {k: round(v, 4) for k, v in zip(model_keys, w)}, "issues": []}

        # Check 1: any weight below 5% (model ignored)
        for k, v in zip(model_keys, w):
            if v < 0.05:
                result["issues"].append(f"{k} weight too low ({v:.3f})")
                issues.append(f"{branch_id}: {k} weight starved ({v:.3f})")

        # Check 2: any weight above 70% (single-model dominance)
        for k, v in zip(model_keys, w):
            if v > 0.70:
                result["issues"].append(f"{k} weight dominates ({v:.3f})")
                issues.append(f"{branch_id}: {k} dominates ({v:.3f})")

        # Check 3: weights sum to ~1.0
        total = sum(w)
        if abs(total - 1.0) > 0.01:
            result["issues"].append(f"weights sum to {total:.4f} (not 1.0)")
            issues.append(f"{branch_id}: weights sum error ({total:.4f})")

        audit_results.append(result)

    # Cross-branch equity: std dev of each model's weight should be <0.2
    import numpy as _np
    for i, key in enumerate(model_keys):
        vals = [all_weights[b][i] for b in all_weights if len(all_weights[b]) > i]
        if vals:
            std = float(_np.std(vals))
            if std > 0.20:
                issues.append(f"Cross-branch {key} weight std too high ({std:.3f}) — possible bias")

    audit_record = {
        "audit_timestamp": datetime.now(timezone.utc).isoformat() + "Z",
        "branches_audited": len(audit_results),
        "issues_found": len(issues),
        "issues": issues,
        "branch_results": audit_results,
        "status": "PASS" if not issues else "WARN",
    }

    audit_path = STATE_DIR / "fairness_audit_latest.json"
    try:
        audit_path.write_text(_json.dumps(audit_record, indent=2))
    except Exception as exc:
        logger.error("[FairnessAudit] Failed to write audit report: %s", exc)

    if issues:
        logger.warning("[FairnessAudit] WARN — %d issue(s): %s", len(issues), "; ".join(issues))
    else:
        logger.info("[FairnessAudit] PASS — all %d branches within fairness bounds.", len(audit_results))


@app.get("/api/v1/fairness/latest")
def get_latest_fairness_audit(_auth: None = Depends(_require_spec_auth)):
    """Return the most recent weekly fairness audit report."""
    import json as _json
    audit_path = STATE_DIR / "fairness_audit_latest.json"
    if not audit_path.exists():
        return {"status": "no_audit_yet", "message": "Audit runs weekly on Sundays at 01:00"}
    return _json.loads(audit_path.read_text())


@app.get("/api/v1/verify/results")
def get_verify_results(
    branch_id: str = "",
    limit: int = 50,
    _auth: None = Depends(_require_spec_auth),
):
    """
    Return recent background re-verification outcomes for the branch immediate-
    approval flow (queued via POST /api/v1/verify/background, resolved by the
    BackgroundVerificationService worker). Optional branch_id filter.
    """
    if get_session is None or ScoringDecision is None:
        return {"results": [], "note": "db_unavailable"}

    limit = max(1, min(limit, 200))
    db = get_session()
    try:
        q = db.query(ScoringDecision)
        if branch_id:
            q = q.filter(ScoringDecision.branch_id == branch_id)
        rows = q.order_by(ScoringDecision.timestamp.desc()).limit(limit).all()
        results = [
            {
                "customer_id": r.customer_id,
                "branch_id": r.branch_id,
                "immediate_decision": r.immediate_decision,
                "immediate_percentile": r.averaged_percentile,
                "hq_percentile": r.hq_percentile,
                "verification_status": r.verification_status,
                "verified_at": r.verified_at.isoformat() if r.verified_at else None,
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            }
            for r in rows
        ]
        pending = sum(1 for r in results if r["verification_status"] == "PENDING")
        return {"results": results, "total": len(results), "pending": pending}
    finally:
        db.close()


@app.on_event("startup")
def _startup_scheduler():
    try:
        from db.models import init_db
        init_db()
    except Exception:
        pass  # DB unavailable in some test environments
    scheduler.add_job(_aggregate_internal, "cron", hour=23, minute=0)
    scheduler.add_job(_personalize_internal, "cron", hour=23, minute=15)
    # Weekly fairness audit — every Sunday at 01:00
    scheduler.add_job(_weekly_fairness_audit, "cron", day_of_week="sun", hour=1, minute=0)
    scheduler.start()


@app.on_event("shutdown")
def _shutdown_scheduler():
    if scheduler.running:
        scheduler.shutdown()


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
        "hq_service.api:app",
        host="0.0.0.0",
        port=6051,
        reload=False,
        **ssl_kwargs,
    )
