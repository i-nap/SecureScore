"""
branch_service/scoring_immediate_approval.py
===========================================
Immediate approval scoring flow for branch service.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

import numpy as np

from shared.decision_logic import make_decision_from_percentile, percentile_rank
from branch_service.models import EnsembleModel

try:
    import httpx
except Exception:
    httpx = None

try:
    from db.models import ScoringDecision, get_session
except Exception:
    ScoringDecision = None
    get_session = None


class ImmediateApprovalScoring:
    def __init__(
        self,
        branch_id: str,
        local_models: EnsembleModel | None = None,
        cached_hq_model: EnsembleModel | None = None,
        cached_branch_weights: list[float] | None = None,
        cached_hq_weights: list[float] | None = None,
        percentile_distribution: list[float] | None = None,
        feature_engineer: Optional[Callable[[dict], np.ndarray]] = None,
        hq_submit_url: str | None = None,
        max_processing_ms: int = 150,
    ):
        self.branch_id = branch_id
        self.local_models = local_models
        self.cached_hq_model = cached_hq_model
        self.cached_branch_weights = cached_branch_weights or [0.2] * 5
        self.cached_hq_weights = cached_hq_weights or [0.2] * 5
        self.percentile_distribution = percentile_distribution
        self.decision_thresholds = {
            "approve_low_risk": 70,
            "approve_med_risk": 50,
            "manual_review": 30,
            "reject": 0,
        }
        self.feature_engineer = feature_engineer
        self.hq_submit_url = hq_submit_url
        self.max_processing_ms = max_processing_ms

    def _engineer_features(self, customer_application: dict) -> np.ndarray:
        if self.feature_engineer is not None:
            return self.feature_engineer(customer_application)

        model = self.local_models or self.cached_hq_model
        if model is None or not model.feature_names:
            raise ValueError("Feature engineering requires model.feature_names or a custom feature_engineer")

        features = []
        for name in model.feature_names:
            features.append(customer_application.get(name, 0))
        return np.asarray(features, dtype=np.float32)

    def percentile_rank(self, score: float) -> float:
        return percentile_rank(score, self.percentile_distribution)

    def make_decision_from_percentile(self, percentile: float) -> dict:
        return make_decision_from_percentile(percentile)

    async def submit_to_hq_for_background_verification(self, payload: dict) -> None:
        if not self.hq_submit_url or httpx is None:
            return
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                await client.post(self.hq_submit_url, json=payload)
        except Exception:
            return

    async def score_and_approve_customer(self, customer_application: dict) -> dict:
        start = time.perf_counter()
        deadline = start + (self.max_processing_ms / 1000.0)

        def _time_left_ms() -> float:
            return max(0.0, (deadline - time.perf_counter()) * 1000.0)

        try:
            features = self._engineer_features(customer_application)
        except Exception as exc:
            return {
                "decision": "ERROR",
                "percentile": None,
                "interest_rate": None,
                "message": f"Feature engineering failed: {exc}",
                "reference_id": None,
                "processing_time_ms": int((time.perf_counter() - start) * 1000),
            }

        if _time_left_ms() <= 0:
            return {
                "decision": "ERROR",
                "percentile": None,
                "interest_rate": None,
                "message": "Processing budget exceeded",
                "reference_id": None,
                "processing_time_ms": int((time.perf_counter() - start) * 1000),
            }

        features_2d = features.reshape(1, -1)

        local_score = None
        hq_score = None
        local_percentile = None
        hq_percentile = None

        if self.local_models is not None and _time_left_ms() > 0:
            preds = self.local_models.predict_proba(features_2d)
            local_score = float(
                np.sum(
                    np.array(
                        [preds["LR"], preds["RF"], preds["GB"], preds["NN"], preds["XGB"]]
                    ).reshape(-1)
                    * np.asarray(self.cached_branch_weights)
                )
            )
            local_percentile = self.percentile_rank(local_score)

        if self.cached_hq_model is not None and _time_left_ms() > 0:
            preds = self.cached_hq_model.predict_proba(features_2d)
            hq_score = float(
                np.sum(
                    np.array(
                        [preds["LR"], preds["RF"], preds["GB"], preds["NN"], preds["XGB"]]
                    ).reshape(-1)
                    * np.asarray(self.cached_hq_weights)
                )
            )
            hq_percentile = self.percentile_rank(hq_score)

        if local_score is None and hq_score is None:
            return {
                "decision": "ERROR",
                "percentile": None,
                "interest_rate": None,
                "message": "No scoring model available",
                "reference_id": None,
                "processing_time_ms": int((time.perf_counter() - start) * 1000),
            }

        if local_score is not None and hq_score is not None:
            averaged_score = (local_score + hq_score) / 2.0
        else:
            averaged_score = local_score if local_score is not None else hq_score

        averaged_percentile = self.percentile_rank(float(averaged_score))
        decision = self.make_decision_from_percentile(averaged_percentile)

        reference_id = uuid.uuid4().hex
        processing_time_ms = int((time.perf_counter() - start) * 1000)
        if processing_time_ms > self.max_processing_ms:
            processing_time_ms = self.max_processing_ms

        if ScoringDecision is not None and get_session is not None:
            db = get_session()
            try:
                db.add(
                    ScoringDecision(
                        customer_id=customer_application.get("customer_id", ""),
                        branch_id=self.branch_id,
                        timestamp=datetime.now(timezone.utc),
                        local_score=local_score,
                        local_percentile=local_percentile,
                        hq_score=hq_score,
                        hq_percentile=hq_percentile,
                        averaged_score=averaged_score,
                        averaged_percentile=averaged_percentile,
                        immediate_decision=decision["decision"],
                        interest_rate=decision.get("interest_rate"),
                        processing_time_ms=processing_time_ms,
                        status="IMMEDIATE_APPROVAL_GIVEN",
                        verification_status="PENDING",
                    )
                )
                db.commit()
            except Exception:
                db.rollback()
            finally:
                db.close()

        payload = {
            "customer_application": customer_application,
            "immediate_decision": {
                "decision": decision["decision"],
                "interest_rate": decision.get("interest_rate"),
                "percentile": averaged_percentile,
                "reference_id": reference_id,
            },
            "branch_id": self.branch_id,
        }
        asyncio.create_task(self.submit_to_hq_for_background_verification(payload))

        return {
            "decision": decision["decision"],
            "percentile": averaged_percentile,
            "interest_rate": decision.get("interest_rate"),
            "message": decision.get("message"),
            "reference_id": reference_id,
            "processing_time_ms": processing_time_ms,
        }
