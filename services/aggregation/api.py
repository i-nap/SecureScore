"""Route handlers for the Aggregation microservice."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .config import (
    BRANCH_TYPE, EXPECTED_MAX_DEPTH, EXPECTED_N_ESTIMATORS,
    MAX_BASE64_CHARS, RATE_LIMIT_SUBMIT,
)
from .fedavg import (
    AggregationState, FairnessReport, agg_state, byzantine_check,
    check_fairness, federated_average, verify_payload_integrity,
)
from .schemas import ByzantineInjectRequest, ByzantineInjectResponse, RollbackRequest, SubmitWeightsRequest, TriggerRequest
from .security import auth_dependency, require_role

logger = logging.getLogger(__name__)

router = APIRouter()


def _run_aggregation_round(state: AggregationState) -> dict:
    with state.lock:
        n = len(state.current_submissions)
        if n < state.min_nodes:
            return {"status": "waiting", "submissions": n, "min_needed": state.min_nodes}

        next_round = state.current_round + 1
        try:
            aggregated = federated_average(state.current_submissions)
        except Exception as exc:
            logger.error("FedAvg failed: %s", exc, exc_info=True)
            return {"status": "error", "detail": str(exc)}

        # Fairness check
        metrics_by_branch = {
            b: sub.get("metrics", {}) for b, sub in state.current_submissions.items()
        }
        fairness = check_fairness(metrics_by_branch)
        if not fairness.passed:
            logger.warning("Fairness violation — quarantining round %d", next_round)
            return {
                "status": "quarantined",
                "reason": "fairness_violation",
                "dp_gap": round(fairness.dp_gap, 4),
                "eo_gap": round(fairness.eo_gap, 4),
            }

        state.current_round += 1
        state.active_version = state.current_round
        model_record = {
            "status": "ready",
            "round": state.current_round,
            "version": state.current_round,
            "weights": aggregated,
            "branches_included": list(state.current_submissions.keys()),
            "branch_metrics": {b: sub.get("metrics", {}) for b, sub in state.current_submissions.items()},
            "aggregated_at": datetime.now(timezone.utc).isoformat(),
            "total_training_samples": sum(
                sub.get("metrics", {}).get("train_size", 0)
                for sub in state.current_submissions.values()
            ),
            "fairness": {"dp_gap": round(fairness.dp_gap, 4), "eo_gap": round(fairness.eo_gap, 4)},
        }

        state.global_model = model_record
        state.save_global_model(state.current_round, model_record)
        state.round_history.append({
            "round": state.current_round,
            "branches": list(state.current_submissions.keys()),
            "aggregated_at": model_record["aggregated_at"],
        })
        state.current_submissions.clear()

        logger.info("FedAvg complete — global model v%d", state.current_round)
        return {
            "status": "completed",
            "round": state.current_round,
            "version": state.current_round,
            "branches_included": model_record["branches_included"],
            "fairness": model_record["fairness"],
        }


@router.post("/api/submit_weights")
def submit_weights(req: SubmitWeightsRequest, request: Request, claims: dict = Depends(auth_dependency)):
    branch = req.branch.title()
    token_branch = claims.get("branch", "")
    token_role = claims.get("role", "")

    if token_role not in ("admin", "branch_operator"):
        raise HTTPException(403, f"Role '{token_role}' cannot submit weights")
    if branch != token_branch and token_role != "admin":
        raise HTTPException(403, f"Token is for '{token_branch}', not '{branch}'")

    if len(req.weights.raw_model_b64) > MAX_BASE64_CHARS:
        raise HTTPException(413, "Model payload too large")
    if req.weights.n_estimators != EXPECTED_N_ESTIMATORS:
        raise HTTPException(422, f"n_estimators must be {EXPECTED_N_ESTIMATORS}")
    if req.weights.max_depth != EXPECTED_MAX_DEPTH:
        raise HTTPException(422, f"max_depth must be {EXPECTED_MAX_DEPTH}")

    ok, msg = verify_payload_integrity(req.weights.raw_model_b64, req.weights.sha256_hash)
    if not ok:
        raise HTTPException(422, f"Integrity check failed: {msg}")

    is_safe, byz_reason = byzantine_check(
        branch, req.weights.raw_model_b64,
        agg_state.baseline_leaf_vectors,
        agg_state.byzantine_sigma,
        agg_state.min_nodes,
    )
    if not is_safe:
        agg_state.anomaly_log.append({
            "branch": branch, "reason": byz_reason,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        raise HTTPException(409, f"Byzantine rejection: {byz_reason}")

    submission = req.model_dump()
    with agg_state.lock:
        agg_state.current_submissions[branch] = submission
        agg_state.save_submission(branch, submission)
        n_sub = len(agg_state.current_submissions)

    return {
        "status": "accepted",
        "branch": branch,
        "round": agg_state.current_round,
        "submissions_so_far": n_sub,
        "byzantine_check": byz_reason,
        "integrity_check": msg,
    }


@router.post("/api/trigger_aggregation")
def trigger_aggregation(_claims: dict = Depends(require_role("admin", "branch_operator"))):
    result = _run_aggregation_round(agg_state)
    return result


@router.post("/api/rollback")
def rollback(req: RollbackRequest, claims: dict = Depends(require_role("admin"))):
    record = agg_state.load_model_version(req.target_version)
    if record is None:
        raise HTTPException(404, f"Version {req.target_version} not found")
    with agg_state.lock:
        old = agg_state.active_version
        agg_state.global_model = record
        agg_state.active_version = req.target_version
    logger.warning("ROLLBACK: v%d → v%d", old, req.target_version)
    return {
        "status": "rolled_back",
        "previous_version": old,
        "active_version": req.target_version,
        "rolled_back_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/api/round_history")
def get_round_history():
    return {
        "rounds": agg_state.round_history,
        "current_round": agg_state.current_round,
        "total_rounds": len(agg_state.round_history),
    }


@router.get("/api/anomaly_log")
def get_anomaly_log():
    return {"anomalies": agg_state.anomaly_log, "total": len(agg_state.anomaly_log)}


@router.post("/debug/inject_byzantine", response_model=ByzantineInjectResponse)
def debug_inject_byzantine(req: ByzantineInjectRequest, _claims=Depends(require_role("admin"))):
    branch = req.branch.title()
    rng = np.random.default_rng(seed=int(time.time() * 1000) % (2 ** 31))
    n_leaves = len(next(iter(agg_state.baseline_leaf_vectors.values()))) if agg_state.baseline_leaf_vectors else 500

    if req.attack_type == "label_flip":
        ref = next(iter(agg_state.baseline_leaf_vectors.values())) if agg_state.baseline_leaf_vectors else None
        vec = -ref + rng.normal(0, 2.0, n_leaves) if ref is not None else rng.normal(0, 10.0, n_leaves)
    elif req.attack_type == "weight_poisoning":
        vec = rng.uniform(-10.0, 10.0, n_leaves)
    else:
        ref = next(iter(agg_state.baseline_leaf_vectors.values())) if agg_state.baseline_leaf_vectors else None
        vec = ref * 8.0 + rng.normal(0, 1.0, n_leaves) if ref is not None else rng.normal(5.0, 3.0, n_leaves)

    if not agg_state.baseline_leaf_vectors:
        return ByzantineInjectResponse(
            detected=False, branch=branch, attack_type=req.attack_type,
            reason="Bootstrap phase — no baselines", cosine_similarity=0.0,
            sigma_threshold=agg_state.byzantine_sigma,
        )

    from .fedavg import _cosine_similarity
    sims = [_cosine_similarity(vec, v) for v in agg_state.baseline_leaf_vectors.values()]
    mean_s = float(np.mean(sims))
    std_s = float(np.std(sims)) if len(sims) > 1 else 0.1
    threshold = max(mean_s - agg_state.byzantine_sigma * max(std_s, 0.05), -0.5)
    min_s = float(min(sims))
    detected = min_s < threshold

    return ByzantineInjectResponse(
        detected=detected, branch=branch, attack_type=req.attack_type,
        reason=f"{'DETECTED' if detected else 'EVADED'} — cosine={min_s:.4f} threshold={threshold:.4f}",
        cosine_similarity=round(min_s, 6),
        sigma_threshold=agg_state.byzantine_sigma,
    )
