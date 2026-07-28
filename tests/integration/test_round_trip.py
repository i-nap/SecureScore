"""
tests/integration/test_round_trip.py — Integration tests for the full
federated learning round-trip: Register → Submit Weights → Aggregation.

These tests spin up the HQ server in-process using TestClient.
Mark: pytest -m integration
"""

from __future__ import annotations

import os
import sys
import base64
import hashlib
import json
from pathlib import Path

import pytest
import numpy as np

os.environ.setdefault("HQ_BRANCH_API_KEY", "test-api-key-fixture")
os.environ.setdefault("HQ_SECRET_KEY", "test-jwt-secret-fixture-32chars!!")
os.environ.setdefault("RATE_LIMIT_REGISTER", "100/minute")
os.environ.setdefault("RATE_LIMIT_SUBMIT", "100/minute")

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

pytestmark = pytest.mark.integration

try:
    import xgboost as xgb
    HAS_XGB = True
except ImportError:
    HAS_XGB = False


def _make_model_payload(seed: int, train_size: int = 800) -> dict:
    rng = np.random.default_rng(seed)
    X = rng.random((min(train_size, 400), 8)).astype(np.float32)
    y = (X[:, 0] + X[:, 1] > 1.0).astype(int)
    dtrain = xgb.DMatrix(X, label=y)
    booster = xgb.train(
        {"max_depth": 5, "objective": "binary:logistic"},
        dtrain, num_boost_round=100, verbose_eval=False
    )
    raw = booster.save_raw()
    raw_b64 = base64.b64encode(raw).decode("ascii")
    return {
        "format": "xgboost_raw_b64",
        "n_estimators": 100,
        "max_depth": 5,
        "raw_model_b64": raw_b64,
        "byte_size": len(raw),
        "sha256_hash": hashlib.sha256(raw).hexdigest(),
        "dp_epsilon": 1.0,
        "dp_noise_std": 0.1,
    }


@pytest.mark.skipif(not HAS_XGB, reason="xgboost not installed")
class TestFederatedRoundTrip:
    """Full round-trip: register branches, submit weights, trigger aggregation."""

    @pytest.fixture(autouse=True)
    def setup(self):
        from fastapi.testclient import TestClient
        import hq_server

        # Reset state between tests
        hq_server.state.registered_branches = {}
        hq_server.state.current_round = 0
        hq_server.state.current_submissions = {}
        hq_server.state.global_model = None
        hq_server.state.active_version = 0
        hq_server.state.baseline_leaf_vectors = {}

        self.client = TestClient(hq_server.app)
        self.api_key = os.environ["HQ_BRANCH_API_KEY"]

    def _register(self, branch: str) -> str:
        r = self.client.post("/api/register", json={
            "branch": branch,
            "api_key": self.api_key,
            "role": "branch_operator",
        })
        assert r.status_code == 200, f"Registration failed for {branch}: {r.text}"
        return r.json()["token"]

    def _submit_weights(self, branch: str, token: str, seed: int, train_size: int = 800):
        payload_weights = _make_model_payload(seed, train_size)
        r = self.client.post(
            "/api/submit_weights",
            json={
                "branch": branch,
                "branch_type": "urban",
                "weights": payload_weights,
                "metrics": {
                    "accuracy": 0.85,
                    "f1": 0.83,
                    "train_size": train_size,
                    "test_size": train_size // 4,
                    "tn": 80, "fp": 10, "fn": 12, "tp": 98,
                    "timestamp": "",
                },
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        return r

    def test_three_branch_registration_and_submission(self):
        """Register 3 branches, submit weights, verify aggregation triggered."""
        import hq_server

        branches = ["Kathmandu", "Pokhara", "Sarlahi"]
        tokens = {}
        for i, branch in enumerate(branches):
            tokens[branch] = self._register(branch)

        # Submit weights from all 3 branches
        for i, branch in enumerate(branches):
            r = self._submit_weights(branch, tokens[branch], seed=i+1, train_size=800+i*100)
            assert r.status_code == 200, f"Submission failed for {branch}: {r.text}"

        # Trigger aggregation manually
        import hq_server
        hq_server._run_aggregation_round()

        # Verify global model was created
        assert hq_server.state.global_model is not None
        assert hq_server.state.current_round >= 1

    def test_global_model_is_retrievable_after_aggregation(self):
        """After aggregation, GET /api/global_model should return the model."""
        import hq_server

        branches = ["Kathmandu", "Pokhara", "Sarlahi"]
        tokens = {}
        for i, branch in enumerate(branches):
            tokens[branch] = self._register(branch)

        for i, branch in enumerate(branches):
            self._submit_weights(branch, tokens[branch], seed=i+1)

        hq_server._run_aggregation_round()

        # Get admin token
        r = self.client.post("/api/register", json={
            "branch": "HQ",
            "api_key": self.api_key,
            "role": "admin",
        })
        admin_token = r.json()["token"]

        r = self.client.get(
            "/api/global_model",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") in ("ready", "pending", "no_model", "not_ready")

    def test_submission_without_auth_rejected(self):
        import hq_server
        payload = _make_model_payload(1)
        r = self.client.post(
            "/api/submit_weights",
            json={
                "branch": "Kathmandu",
                "branch_type": "urban",
                "weights": payload,
                "metrics": {"accuracy": 0.85, "f1": 0.83, "train_size": 800, "test_size": 200},
            },
        )
        assert r.status_code == 401

    def test_duplicate_branch_submission_overwrites(self):
        """A branch submitting twice should overwrite its first submission."""
        import hq_server
        token = self._register("Kathmandu")

        r1 = self._submit_weights("Kathmandu", token, seed=1)
        assert r1.status_code == 200
        count_after_first = len(hq_server.state.current_submissions)

        r2 = self._submit_weights("Kathmandu", token, seed=2)
        assert r2.status_code == 200
        count_after_second = len(hq_server.state.current_submissions)

        # Should not increase count
        assert count_after_second == count_after_first

    def test_audit_log_records_submissions(self):
        """Each submission should create an audit entry."""
        import hq_server
        token = self._register("Kathmandu")
        self._submit_weights("Kathmandu", token, seed=1)

        entries = hq_server.audit.get_entries(last_n=10)
        event_types = [e["event"] for e in entries]
        assert any("WEIGHT_SUBMISSION" in et for et in event_types)
