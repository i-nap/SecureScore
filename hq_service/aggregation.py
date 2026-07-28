"""
hq_service/aggregation.py
==========================
Federated gradient aggregation (FedAvg with Byzantine robustness).
The core logic lives here and is imported by hq_service/api.py.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Dict, List, Optional

import numpy as np

from branch_service.models import EnsembleModel

logger = logging.getLogger(__name__)

STATE_DIR = Path(os.getenv("HQ_STATE_DIR", "hq_state"))
STATE_DIR.mkdir(parents=True, exist_ok=True)
AGG_PATH = STATE_DIR / "aggregated_gradients.json"
MODEL_PATH = STATE_DIR / "global_ensemble.json"

BYZANTINE_SIGMA = float(os.getenv("HQ_BYZANTINE_SIGMA", "2.0"))
FAIRNESS_THRESHOLD = float(os.getenv("FAIRNESS_THRESHOLD", "0.05"))

BRANCH_TYPE: Dict[str, str] = {
    "Kathmandu": "urban",
    "Lalitpur": "urban",
    "Pokhara": "urban",
    "Bharatpur": "semi_urban",
    "Biratnagar": "semi_urban",
    "Butwal": "semi_urban",
    "Hetauda": "semi_urban",
    "Itahari": "semi_urban",
    "Dharan": "semi_urban",
    "Janakpur": "rural",
    "Birgunj": "rural",
    "Nepalgunj": "rural",
    "Sarlahi": "rural",
}


@dataclass
class FairnessReport:
    passed: bool
    dp_gap: float
    eo_gap: float
    message: str = ""


def check_fairness(metrics_by_branch: Dict[str, dict]) -> FairnessReport:
    """
    Compute demographic parity gap and equal opportunity gap between urban/rural.
    Returns FairnessReport; passed=False triggers round quarantine.
    Threshold: FAIRNESS_THRESHOLD (default 5 percentage points).
    """
    urban = [m for b, m in metrics_by_branch.items() if BRANCH_TYPE.get(b) == "urban"]
    rural = [m for b, m in metrics_by_branch.items() if BRANCH_TYPE.get(b) == "rural"]

    if not urban or not rural:
        return FairnessReport(passed=True, dp_gap=0.0, eo_gap=0.0,
                              message="insufficient branches for fairness check")

    dp_gap = abs(
        mean(m.get("false_positive_rate", 0.0) for m in urban) -
        mean(m.get("false_positive_rate", 0.0) for m in rural)
    )
    eo_gap = abs(
        mean(m.get("true_positive_rate", 0.0) for m in urban) -
        mean(m.get("true_positive_rate", 0.0) for m in rural)
    )

    passed = dp_gap <= FAIRNESS_THRESHOLD and eo_gap <= FAIRNESS_THRESHOLD
    if not passed:
        logger.warning(
            "[Fairness] Violation detected — dp_gap=%.4f eo_gap=%.4f threshold=%.4f",
            dp_gap, eo_gap, FAIRNESS_THRESHOLD,
        )
    return FairnessReport(passed=passed, dp_gap=dp_gap, eo_gap=eo_gap)


class FederatedAggregator:
    """
    Weighted FedAvg aggregator with optional Byzantine filtering.

    Steps per round:
      1. Collect compressed gradients from all branches (via DB)
      2. Decompress each upload
      3. Byzantine filter — discard updates whose L2 norm deviates
         more than BYZANTINE_SIGMA standard deviations from the mean
      4. Weighted average (weight = branch data_volume)
      5. Apply gradient update to the global EnsembleModel
      6. Persist the updated model
    """

    def __init__(self) -> None:
        self.global_model: Optional[EnsembleModel] = self._load_or_init_model()

    # ------------------------------------------------------------------ #
    # Public entry point called by the API scheduler
    # ------------------------------------------------------------------ #

    def aggregate(self, uploads: list) -> dict:
        """
        Aggregate a list of GradientUpload ORM objects.

        Returns:
            {
              'status': 'success' | 'error',
              'models_updated': int,
              'global_model_updated': bool,
              'branches_filtered': int,  # Byzantine-filtered count
            }
        """
        if not uploads:
            logger.info("[Aggregator] No uploads to aggregate.")
            return {"status": "success", "models_updated": 0, "global_model_updated": False, "branches_filtered": 0}

        helper = EnsembleModel()
        decompressed_per_branch: List[Dict] = []
        volumes: List[float] = []

        for upload in uploads:
            try:
                grad = helper.decompress_gradients(upload.compressed_gradients)
                decompressed_per_branch.append(grad)
                volumes.append(float(upload.data_volume or 1))
            except Exception as exc:
                logger.warning("[Aggregator] Skipping upload %s — decompression failed: %s", upload.id, exc)

        if not decompressed_per_branch:
            return {"status": "error", "message": "All uploads failed decompression", "models_updated": 0, "global_model_updated": False, "branches_filtered": 0}

        # Byzantine filtering per model key
        filtered_grads, filtered_volumes, n_filtered = self._byzantine_filter(decompressed_per_branch, volumes)

        # Fairness check — quarantine round if urban/rural gap exceeds threshold
        metrics_by_branch: Dict[str, dict] = {}
        for upload in uploads:
            branch = getattr(upload, "branch_name", "") or getattr(upload, "branch", "")
            if branch:
                try:
                    metrics = json.loads(upload.metrics) if isinstance(upload.metrics, str) else (upload.metrics or {})
                    metrics_by_branch[branch] = metrics
                except Exception:
                    metrics_by_branch[branch] = {}

        if metrics_by_branch:
            fairness = check_fairness(metrics_by_branch)
            if not fairness.passed:
                logger.error(
                    "[Aggregator] Round QUARANTINED due to fairness violation — dp_gap=%.4f eo_gap=%.4f",
                    fairness.dp_gap, fairness.eo_gap,
                )
                return {
                    "status": "quarantined",
                    "reason": "fairness_violation",
                    "dp_gap": round(fairness.dp_gap, 4),
                    "eo_gap": round(fairness.eo_gap, 4),
                    "threshold": FAIRNESS_THRESHOLD,
                    "models_updated": 0,
                    "global_model_updated": False,
                    "branches_filtered": n_filtered,
                }

        # Weighted FedAvg
        aggregated = self._fedavg(filtered_grads, filtered_volumes)

        # Persist aggregated gradients as JSON (no pickle — RCE risk)
        try:
            serializable = {k: v.tolist() if isinstance(v, np.ndarray) else list(v) for k, v in aggregated.items()}
            with open(AGG_PATH, "w", encoding="utf-8") as f:
                json.dump(serializable, f)
        except Exception as exc:
            logger.error("[Aggregator] Failed to persist aggregated gradients: %s", exc)

        # Apply update to global model
        updated = self._apply_update(aggregated)

        return {
            "status": "success",
            "models_updated": len(uploads),
            "global_model_updated": updated,
            "branches_filtered": n_filtered,
        }

    def get_global_model(self) -> EnsembleModel:
        return self.global_model

    # ------------------------------------------------------------------ #
    # Private helpers
    # ------------------------------------------------------------------ #

    def _byzantine_filter(
        self,
        all_grads: List[Dict],
        volumes: List[float],
    ) -> tuple[List[Dict], List[float], int]:
        """
        For each model key, compute the L2 norm of each branch's gradient.
        Discard branches whose norm is > BYZANTINE_SIGMA std-devs from mean.
        A branch is kept only if it passes the filter for ALL model keys.
        """
        if len(all_grads) <= 2:
            return all_grads, volumes, 0  # Not enough to filter

        # Per model-key norms per branch
        model_keys = list(all_grads[0].keys())
        norms = np.zeros((len(all_grads), len(model_keys)))

        for i, grad_dict in enumerate(all_grads):
            for j, key in enumerate(model_keys):
                g = np.asarray(grad_dict.get(key, []))
                norms[i, j] = float(np.linalg.norm(g)) if g.size else 0.0

        # Mark branches that are outliers in any model dimension
        keep = np.ones(len(all_grads), dtype=bool)
        for j in range(len(model_keys)):
            col = norms[:, j]
            mean, std = col.mean(), col.std()
            outliers = np.abs(col - mean) > BYZANTINE_SIGMA * std
            keep &= ~outliers

        n_filtered = int((~keep).sum())
        if n_filtered:
            logger.warning("[Aggregator] Byzantine filter removed %d/%d branches.", n_filtered, len(all_grads))

        filtered_grads = [g for g, k in zip(all_grads, keep) if k]
        filtered_volumes = [v for v, k in zip(volumes, keep) if k]
        return filtered_grads, filtered_volumes, n_filtered

    def _fedavg(self, all_grads: List[Dict], volumes: List[float]) -> Dict:
        """Compute weighted average gradients (FedAvg)."""
        combined: Dict[str, np.ndarray] = {}
        weight_totals: Dict[str, float] = {}

        for grad_dict, vol in zip(all_grads, volumes):
            for key, g in grad_dict.items():
                arr = np.asarray(g, dtype=float)
                combined[key] = combined.get(key, np.zeros_like(arr)) + arr * vol
                weight_totals[key] = weight_totals.get(key, 0.0) + vol

        return {k: combined[k] / max(weight_totals.get(k, 1.0), 1e-9) for k in combined}

    def _apply_update(self, aggregated: Dict) -> bool:
        """Apply aggregated gradient update to the global model (SGD step)."""
        if self.global_model is None:
            self.global_model = EnsembleModel()

        updated = False
        lr = 0.01

        # Logistic Regression — update coef_ directly
        lr_model = self.global_model.models.get("LR")
        if lr_model is not None and hasattr(lr_model, "coef_") and "LR" in aggregated:
            grad = np.asarray(aggregated["LR"]).reshape(-1)
            coef = lr_model.coef_.reshape(-1)
            if grad.shape[0] == coef.shape[0] + 1:
                lr_model.coef_ = (coef - lr * grad[:-1]).reshape(lr_model.coef_.shape)
                lr_model.intercept_ = np.asarray([lr_model.intercept_[0] - lr * grad[-1]])
                updated = True

        # Neural Network — PyTorch SGD step
        try:
            import torch
            nn_model = self.global_model.models.get("NN")
            if nn_model is not None and "NN" in aggregated:
                nn_lr = 0.001
                grad = np.asarray(aggregated["NN"]).reshape(-1)
                params = [p for p in nn_model.parameters() if p.requires_grad]
                total = sum(int(p.numel()) for p in params)
                if total == grad.shape[0]:
                    offset = 0
                    for p in params:
                        size = int(p.numel())
                        upd = grad[offset : offset + size].reshape(p.data.shape)
                        p.data = p.data - nn_lr * p.data.new_tensor(upd)
                        offset += size
                    updated = True
        except Exception:
            pass

        # Persist
        try:
            self.global_model.save_model(str(MODEL_PATH))
            logger.info("[Aggregator] Global model saved to %s", MODEL_PATH)
        except Exception as exc:
            logger.error("[Aggregator] Failed to save global model: %s", exc)

        return updated

    def _load_or_init_model(self) -> EnsembleModel:
        if MODEL_PATH.exists():
            try:
                model = EnsembleModel.load_model(str(MODEL_PATH))
                logger.info("[Aggregator] Loaded existing global model from %s", MODEL_PATH)
                return model
            except Exception as exc:
                logger.warning("[Aggregator] Could not load global model (%s) — initialising fresh.", exc)
        return EnsembleModel()
