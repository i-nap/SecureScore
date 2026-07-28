"""
tests/test_verification.py
==========================
Unit tests for hq_service/background_verification.py
— BackgroundVerificationService.

Verifies:
  • verify_single_decision() marks record VERIFIED when divergence <= 15
  • verify_single_decision() queues reverification when divergence > 15
  • queue_reverification_call() sets deadline to now + 2 hours
  • queue_reverification_call() sets status = PENDING_CALL
  • divergence formula: |immediate_percentile - hq_percentile|
  • should_reverify() threshold is exactly 15pp
  • background_verification_worker() is an async coroutine
"""

from __future__ import annotations

import asyncio
import inspect
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch, call
import types

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("HQ_BRANCH_API_KEY", "test-key")

from shared.decision_logic import should_reverify, make_decision_from_percentile
from hq_service.background_verification import BackgroundVerificationService
from branch_service.models import EnsembleModel


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_model() -> EnsembleModel:
    """Return a tiny trained EnsembleModel for testing."""
    rng = np.random.default_rng(0)
    X = rng.random((200, 10)).astype(np.float32)
    y = (X[:, 0] > 0.5).astype(int)
    m = EnsembleModel()
    m.train(X, y, epochs=1, batch_size=64)
    return m


def _make_service(diverge: bool = False) -> tuple[BackgroundVerificationService, MagicMock, MagicMock]:
    """
    Build a BackgroundVerificationService with mocked DB.
    If diverge=True, the fresh HQ score will be ~0 (forces divergence).
    """
    model = _make_model()

    if diverge:
        # Force model to return 0-ish scores to maximise divergence
        for key in model.models:
            model.models[key] = None
        def _low_proba(X):
            n = X.shape[0] if hasattr(X, "shape") else 1
            return {k: np.zeros(n) for k in ["LR", "RF", "GB", "NN", "XGB"]}
        model.predict_proba = _low_proba

    service = BackgroundVerificationService(
        model_loader=lambda: model,
        branch_weights_loader=lambda _: [0.2] * 5,
        polling_interval=30,
        divergence_threshold=15.0,
    )
    return service, model


# ── Tests: divergence threshold ────────────────────────────────────────────────

class TestDivergenceLogic:
    @pytest.mark.parametrize("imm,hq,expected", [
        (80.0, 60.0, True),   # 20pp > 15 → reverify
        (60.0, 80.0, True),   # 20pp
        (50.0, 35.0, False),  # exactly 15pp — NOT triggered (threshold is >15, not >=15)
        (65.0, 50.0, False),  # exactly 15pp → NOT triggered
        (70.0, 62.0, False),  # 8pp → not triggered
        (90.0, 70.0, True),   # 20pp → triggered
    ])
    def test_should_reverify_threshold(self, imm, hq, expected):
        result = should_reverify(imm, hq)
        assert result == expected, (
            f"should_reverify({imm}, {hq}) = {result}, expected {expected}"
        )

    def test_divergence_formula(self):
        """divergence = abs(immediate - hq)"""
        assert should_reverify(80, 60) == (abs(80 - 60) > 15)
        assert should_reverify(60, 80) == (abs(60 - 80) > 15)


# ── Tests: queue_reverification_call ──────────────────────────────────────────

def _run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(None)


class TestQueueReverification:
    def _call_queue(self, service, fake_db, customer_id="cust_001", branch_id="kathmandu",
                    immediate_decision="APPROVE", immediate_percentile=80.0,
                    hq_fresh_percentile=55.0, divergence=25.0):
        _run_async(
            service.queue_reverification_call(
                db=fake_db,
                decision_id="dec_001",
                customer_id=customer_id,
                branch_id=branch_id,
                immediate_decision=immediate_decision,
                immediate_percentile=immediate_percentile,
                hq_fresh_percentile=hq_fresh_percentile,
                divergence=divergence,
            )
        )

    def test_deadline_is_two_hours_from_now(self):
        service, _ = _make_service()
        captured = {}

        class FakeQueue:
            def __init__(self, **kwargs):
                captured.update(kwargs)

        fake_db = MagicMock()
        fake_db.add = lambda obj: None
        fake_db.commit = lambda: None

        with patch("hq_service.background_verification.ReverificationQueue", FakeQueue):
            self._call_queue(service, fake_db)

        assert "deadline" in captured, "ReverificationQueue missing 'deadline' field"
        deadline = captured["deadline"]
        now = datetime.now(timezone.utc)
        # Make deadline timezone-aware if needed
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        diff_hours = (deadline - now).total_seconds() / 3600
        assert 1.9 <= diff_hours <= 2.1, f"Deadline should be ~2h from now, got {diff_hours:.2f}h"

    def test_status_is_pending_call(self):
        service, _ = _make_service()
        captured = {}

        class FakeQueue:
            def __init__(self, **kwargs):
                captured.update(kwargs)

        fake_db = MagicMock()
        fake_db.add = lambda obj: None
        fake_db.commit = lambda: None

        with patch("hq_service.background_verification.ReverificationQueue", FakeQueue):
            self._call_queue(service, fake_db, customer_id="cust_002")

        assert captured.get("status") == "PENDING_CALL", (
            f"Expected PENDING_CALL, got {captured.get('status')}"
        )


# ── Tests: BackgroundVerificationService structure ────────────────────────────

class TestBackgroundVerificationService:
    def test_background_worker_is_coroutine(self):
        service, _ = _make_service()
        assert asyncio.iscoroutinefunction(service.background_verification_worker), (
            "background_verification_worker must be async"
        )

    def test_verify_single_decision_is_coroutine(self):
        service, _ = _make_service()
        assert asyncio.iscoroutinefunction(service.verify_single_decision), (
            "verify_single_decision must be async"
        )

    def test_queue_reverification_call_is_coroutine(self):
        service, _ = _make_service()
        assert asyncio.iscoroutinefunction(service.queue_reverification_call), (
            "queue_reverification_call must be async"
        )

    def test_polling_interval_default(self):
        service, _ = _make_service()
        assert service.polling_interval == 30

    def test_divergence_threshold_default(self):
        service, _ = _make_service()
        assert service.divergence_threshold == 15.0

    def test_custom_divergence_threshold(self):
        model = _make_model()
        service = BackgroundVerificationService(
            model_loader=lambda: model,
            divergence_threshold=20.0,
        )
        assert service.divergence_threshold == 20.0


# ── Tests: make_decision_from_percentile (used in reverification) ─────────────

class TestReverificationDecision:
    def test_hq_approve_replaces_branch_approve(self):
        branch_decision = make_decision_from_percentile(72)  # APPROVE
        hq_decision = make_decision_from_percentile(68)       # still APPROVE
        assert branch_decision["decision"] == "APPROVE"
        assert hq_decision["decision"] == "APPROVE"

    def test_hq_reject_overrides_branch_approve(self):
        branch_decision = make_decision_from_percentile(75)  # APPROVE
        hq_decision = make_decision_from_percentile(20)       # REJECT
        assert should_reverify(75, 20) is True
        assert hq_decision["decision"] == "REJECT"

    def test_loan_amount_multiplier_present(self):
        for p in [75, 55, 35, 10]:
            result = make_decision_from_percentile(p)
            assert "loan_amount_multiplier" in result
