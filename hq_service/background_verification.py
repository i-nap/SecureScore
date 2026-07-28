"""
hq_service/background_verification.py
====================================
Background verification workflow for HQ.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Callable

import numpy as np

from shared.decision_logic import make_decision_from_percentile, percentile_rank
from branch_service.models import EnsembleModel

try:
    from db.models import (
        get_session,
        ScoringDecision,
        CustomerApplication,
        VerificationLog,
        ReverificationQueue,
    )
except Exception:
    get_session = None
    ScoringDecision = None
    CustomerApplication = None
    VerificationLog = None
    ReverificationQueue = None


class BackgroundVerificationService:
    def __init__(
        self,
        model_loader: Callable[[], EnsembleModel],
        branch_weights_loader: Callable[[str], list[float]] | None = None,
        feature_engineer: Callable[[dict], np.ndarray] | None = None,
        polling_interval: int = 30,
        divergence_threshold: float = 15.0,
        percentile_distribution: list[float] | None = None,
        twilio_client=None,
    ):
        self.model_loader = model_loader
        self.branch_weights_loader = branch_weights_loader
        self.feature_engineer = feature_engineer
        self.polling_interval = polling_interval
        self.divergence_threshold = divergence_threshold
        self.percentile_distribution = percentile_distribution
        self.logger = logging.getLogger("hq.verify")
        self.twilio_client = twilio_client

    async def background_verification_worker(self) -> None:
        if get_session is None:
            raise RuntimeError("Database is not available")

        while True:
            await asyncio.sleep(self.polling_interval)
            db = get_session()
            try:
                cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
                decisions = (
                    db.query(ScoringDecision)
                    .filter(
                        ScoringDecision.status == "IMMEDIATE_APPROVAL_GIVEN",
                        ScoringDecision.verification_status == "PENDING",
                        ScoringDecision.timestamp >= cutoff,
                    )
                    .all()
                )
                for decision in decisions:
                    await self.verify_single_decision(decision.id)
            finally:
                db.close()

    async def verify_single_decision(self, decision_id: str) -> None:
        if get_session is None:
            return

        db = get_session()
        try:
            decision = db.query(ScoringDecision).filter(ScoringDecision.id == decision_id).one_or_none()
            if decision is None:
                return

            app = (
                db.query(CustomerApplication)
                .filter(CustomerApplication.customer_id == decision.customer_id)
                .order_by(CustomerApplication.created_at.desc())
                .first()
            )
            if app is None:
                decision.verification_status = "VERIFIED"
                decision.verified_at = datetime.now(timezone.utc)
                db.commit()
                return

            customer_payload = {
                "customer_id": decision.customer_id,
                "age": app.age,
                "income": app.income,
                "savings_balance": app.savings_balance,
                "employment": app.employment,
                "transaction_count_30d": app.transaction_count_30d,
            }
            if app.features_payload:
                customer_payload.update(app.features_payload)

            if self.feature_engineer is None:
                model = self.model_loader()
                features = np.asarray([customer_payload.get(n, 0) for n in model.feature_names], dtype=np.float32)
            else:
                features = self.feature_engineer(customer_payload)

            model = self.model_loader()
            preds = model.predict_proba(features.reshape(1, -1))
            weights = (
                self.branch_weights_loader(decision.branch_id)
                if self.branch_weights_loader is not None
                else [0.2] * 5
            )
            hq_score = float(
                np.sum(
                    np.array(
                        [preds["LR"], preds["RF"], preds["GB"], preds["NN"], preds["XGB"]]
                    ).reshape(-1)
                    * np.asarray(weights)
                )
            )
            hq_percentile = percentile_rank(hq_score, self.percentile_distribution)

            divergence = abs((decision.averaged_percentile or 0.0) - hq_percentile)
            if divergence <= self.divergence_threshold:
                decision.verification_status = "VERIFIED"
                decision.status = "VERIFIED"
                decision.verified_at = datetime.now(timezone.utc)
                requires_reverification = False
            else:
                decision.verification_status = "REVERIFICATION_QUEUED"
                decision.status = "REVERIFICATION_QUEUED"
                requires_reverification = True
                self.logger.warning(
                    "Divergence %.2f > %.2f for customer %s (branch %s)",
                    divergence,
                    self.divergence_threshold,
                    decision.customer_id,
                    decision.branch_id,
                )
                await self.queue_reverification_call(
                    db,
                    decision_id=decision.id,
                    customer_id=decision.customer_id,
                    branch_id=decision.branch_id,
                    immediate_decision=decision.immediate_decision,
                    immediate_percentile=decision.averaged_percentile or 0.0,
                    hq_fresh_percentile=hq_percentile,
                    divergence=divergence,
                )

            db.add(
                VerificationLog(
                    scoring_decision_id=decision.id,
                    customer_id=decision.customer_id,
                    immediate_percentile=decision.averaged_percentile,
                    hq_fresh_percentile=hq_percentile,
                    divergence=divergence,
                    requires_reverification=requires_reverification,
                )
            )
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

    async def queue_reverification_call(
        self,
        db,
        decision_id: str,
        customer_id: str,
        branch_id: str,
        immediate_decision: str,
        immediate_percentile: float,
        hq_fresh_percentile: float,
        divergence: float,
    ) -> None:
        revised = make_decision_from_percentile(hq_fresh_percentile)
        phone_number = None
        if hasattr(db, "query"):
            # best effort, phone_number stored on Customer in spec
            try:
                from db.models import Customer
                cust = db.query(Customer).filter(Customer.id == customer_id).one_or_none()
                if cust:
                    phone_number = cust.phone_number
            except Exception:
                phone_number = None

        db.add(
            ReverificationQueue(
                customer_id=customer_id,
                phone_number=phone_number or "",
                immediate_decision=immediate_decision,
                revised_decision=revised["decision"],
                immediate_percentile=immediate_percentile,
                hq_percentile=hq_fresh_percentile,
                divergence=divergence,
                queued_at=datetime.now(timezone.utc),
                deadline=datetime.now(timezone.utc) + timedelta(hours=2),
                status="PENDING_CALL",
            )
        )
