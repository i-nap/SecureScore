"""
fedavg.py — Core federated averaging and Byzantine fault tolerance logic.
Extracted from hq_server.py for independent microservice deployment.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Optional

import numpy as np
import xgboost as xgb

from .config import (
    BRANCH_TYPE, BYZANTINE_SIGMA, DP_CLIP_NORM, EXPECTED_MAX_DEPTH,
    EXPECTED_N_ESTIMATORS, FAIRNESS_THRESHOLD, HQ_STATE_DIR, MIN_NODES,
    MODEL_REGISTRY_DIR,
)

logger = logging.getLogger(__name__)


# ── Byzantine fault tolerance ────────────────────────────

def _extract_leaf_vector(raw_b64: str) -> np.ndarray:
    raw = base64.b64decode(raw_b64)
    booster = xgb.Booster()
    booster.load_model(bytearray(raw))
    dump = booster.get_dump(dump_format="text")
    leaves = []
    for tree_str in dump:
        for line in tree_str.strip().split("\n"):
            if "leaf=" in line:
                val_str = line.split("leaf=")[1].split(",")[0]
                leaves.append(float(val_str))
    return np.array(leaves, dtype=np.float64)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    min_len = min(len(a), len(b))
    a, b = a[:min_len], b[:min_len]
    dot = np.dot(a, b)
    norm = np.linalg.norm(a) * np.linalg.norm(b)
    return float(dot / norm) if norm != 0 else 0.0


def byzantine_check(
    branch: str,
    raw_b64: str,
    baseline_vectors: dict[str, np.ndarray],
    sigma: float = BYZANTINE_SIGMA,
    min_nodes: int = MIN_NODES,
) -> tuple[bool, str]:
    try:
        incoming = _extract_leaf_vector(raw_b64)
    except Exception as e:
        return False, f"Could not parse model weights: {e}"

    if not baseline_vectors:
        baseline_vectors[branch] = incoming
        return True, "First round — no baseline"

    if len(baseline_vectors) < min_nodes:
        baseline_vectors[branch] = incoming
        return True, f"Bootstrap phase ({len(baseline_vectors)}/{min_nodes})"

    sims = [_cosine_similarity(incoming, v) for v in baseline_vectors.values()]
    mean_sim = float(np.mean(sims))
    std_sim = float(np.std(sims)) if len(sims) > 1 else 0.1
    threshold = max(mean_sim - sigma * max(std_sim, 0.05), -0.5)
    min_sim = float(min(sims))

    if min_sim < threshold:
        return False, (
            f"REJECTED — cosine {min_sim:.4f} < threshold {threshold:.4f} "
            f"(mean={mean_sim:.4f}, sigma={sigma})"
        )

    baseline_vectors[branch] = incoming
    return True, f"Accepted — min similarity {min_sim:.4f}"


# ── Payload integrity ────────────────────────────────────

def verify_payload_integrity(raw_b64: str, sha256_hash: str) -> tuple[bool, str]:
    if not sha256_hash:
        return True, "No hash (legacy)"
    try:
        raw = base64.b64decode(raw_b64)
    except Exception as e:
        return False, f"Invalid base64: {e}"
    actual = hashlib.sha256(raw).hexdigest()
    if not hmac.compare_digest(actual, sha256_hash):
        return False, f"INTEGRITY FAILURE: {sha256_hash[:16]} != {actual[:16]}"
    return True, f"Verified: {actual[:16]}"


# ── FedAvg ───────────────────────────────────────────────

def _recursive_average_nodes(template: dict, all_nodes: list[dict], weights: list[float]):
    if "leaf" in template:
        vals = [n["leaf"] if "leaf" in n else template["leaf"] for n in all_nodes]
        template["leaf"] = float(np.average(vals, weights=weights))
        return
    if "children" in template:
        for idx, child in enumerate(template["children"]):
            others = [
                n["children"][idx] if "children" in n and idx < len(n["children"]) else child
                for n in all_nodes
            ]
            _recursive_average_nodes(child, others, weights)


def federated_average(submissions: dict[str, dict]) -> dict:
    """Weighted FedAvg: w_global = Σ (n_i / n) · w_i"""
    branches = list(submissions.keys())
    sizes = {b: submissions[b].get("metrics", {}).get("train_size", 100) for b in branches}
    total_n = sum(sizes.values()) or 1
    bw = {b: sizes[b] / total_n for b in branches}

    booster_jsons: list[tuple[str, dict, float]] = []
    for b in branches:
        raw = base64.b64decode(submissions[b]["weights"]["raw_model_b64"])
        booster = xgb.Booster()
        booster.load_model(bytearray(raw))
        booster_jsons.append((b, json.loads(booster.save_raw("json")), bw[b]))

    template_b = max(branches, key=lambda b: sizes[b])
    template_idx = branches.index(template_b)
    template_json = json.loads(json.dumps(booster_jsons[template_idx][1]))

    try:
        trees = template_json["learner"]["gradient_booster"]["model"]["trees"]
    except KeyError:
        logger.warning("Cannot parse tree structure — using best-F1 fallback")
        return _fallback_best_model(submissions, sizes)

    for tree_idx, tree in enumerate(trees):
        others, ws = [], []
        for _, bj, w in booster_jsons:
            try:
                others.append(bj["learner"]["gradient_booster"]["model"]["trees"][tree_idx])
            except (KeyError, IndexError):
                others.append(tree)
            ws.append(w)
        _recursive_average_nodes(tree, others, ws)

    averaged = xgb.Booster()
    averaged.load_model(bytearray(json.dumps(template_json).encode()))
    raw = averaged.save_raw()
    encoded = base64.b64encode(raw).decode()
    return {
        "format": "xgboost_raw_b64",
        "n_estimators": EXPECTED_N_ESTIMATORS,
        "max_depth": EXPECTED_MAX_DEPTH,
        "raw_model_b64": encoded,
        "byte_size": len(raw),
        "sha256_hash": hashlib.sha256(raw).hexdigest(),
    }


def _fallback_best_model(submissions: dict, sizes: dict) -> dict:
    best = max(submissions, key=lambda b: submissions[b].get("metrics", {}).get("f1", 0))
    w = submissions[best]["weights"]
    return {
        "format": w.get("format", "xgboost_raw_b64"),
        "n_estimators": w.get("n_estimators", EXPECTED_N_ESTIMATORS),
        "max_depth": w.get("max_depth", EXPECTED_MAX_DEPTH),
        "raw_model_b64": w["raw_model_b64"],
        "byte_size": w.get("byte_size", 0),
        "sha256_hash": w.get("sha256_hash", ""),
    }


# ── Fairness check ───────────────────────────────────────

@dataclass
class FairnessReport:
    passed: bool
    dp_gap: float = 0.0
    eo_gap: float = 0.0
    message: str = ""


def check_fairness(metrics_by_branch: dict[str, dict]) -> FairnessReport:
    urban = [m for b, m in metrics_by_branch.items() if BRANCH_TYPE.get(b) == "urban"]
    rural = [m for b, m in metrics_by_branch.items() if BRANCH_TYPE.get(b) == "rural"]

    if not urban or not rural:
        return FairnessReport(passed=True, message="insufficient branches for fairness check")

    dp_gap = abs(
        mean(m.get("false_positive_rate", m.get("fp", 0) / max(m.get("fp", 0) + m.get("tn", 1), 1)) for m in urban) -
        mean(m.get("false_positive_rate", m.get("fp", 0) / max(m.get("fp", 0) + m.get("tn", 1), 1)) for m in rural)
    )
    eo_gap = abs(
        mean(m.get("true_positive_rate", m.get("tp", 0) / max(m.get("tp", 0) + m.get("fn", 1), 1)) for m in urban) -
        mean(m.get("true_positive_rate", m.get("tp", 0) / max(m.get("tp", 0) + m.get("fn", 1), 1)) for m in rural)
    )

    passed = dp_gap <= FAIRNESS_THRESHOLD and eo_gap <= FAIRNESS_THRESHOLD
    if not passed:
        logger.warning("Fairness violation: dp_gap=%.4f eo_gap=%.4f", dp_gap, eo_gap)
    return FairnessReport(passed=passed, dp_gap=dp_gap, eo_gap=eo_gap)


# ── In-memory aggregation state ──────────────────────────

class AggregationState:
    def __init__(self):
        self.lock = threading.Lock()
        self.current_round: int = 0
        self.current_submissions: dict[str, dict] = {}
        self.global_model: Optional[dict] = None
        self.active_version: int = 0
        self.round_history: list[dict] = []
        self.baseline_leaf_vectors: dict[str, np.ndarray] = {}
        self.anomaly_log: list[dict] = []
        self.min_nodes: int = MIN_NODES
        self.byzantine_sigma: float = BYZANTINE_SIGMA

    def save_global_model(self, version: int, payload: dict):
        (HQ_STATE_DIR / "global_model_latest.json").write_text(json.dumps(payload))
        (MODEL_REGISTRY_DIR / f"global_model_v{version}.json").write_text(json.dumps(payload))

    def load_model_version(self, version: int) -> Optional[dict]:
        path = MODEL_REGISTRY_DIR / f"global_model_v{version}.json"
        return json.loads(path.read_text()) if path.exists() else None

    def list_model_versions(self) -> list[int]:
        return sorted(
            int(p.stem.split("_v")[1])
            for p in MODEL_REGISTRY_DIR.glob("global_model_v*.json")
        )

    def save_submission(self, branch: str, data: dict):
        path = HQ_STATE_DIR / f"round{self.current_round}_submission_{branch.lower()}.json"
        path.write_text(json.dumps(data))


# Singleton state shared within the aggregation service process
agg_state = AggregationState()
