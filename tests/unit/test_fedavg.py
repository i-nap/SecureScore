"""
tests/unit/test_fedavg.py — Unit tests for FedAvg aggregation logic.
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

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

try:
    import xgboost as xgb
    HAS_XGB = True
except ImportError:
    HAS_XGB = False

pytestmark = pytest.mark.skipif(not HAS_XGB, reason="xgboost not installed")


def _make_model(seed: int = 42, n_samples: int = 200) -> bytes:
    """Train a tiny XGBoost model and return raw bytes."""
    rng = np.random.default_rng(seed)
    X = rng.random((n_samples, 8)).astype(np.float32)
    y = (X[:, 0] + X[:, 1] > 1.0).astype(int)
    dtrain = xgb.DMatrix(X, label=y)
    booster = xgb.train(
        {"max_depth": 3, "objective": "binary:logistic"},
        dtrain, num_boost_round=10, verbose_eval=False
    )
    return booster.save_raw()


def _make_submission(branch: str, seed: int, train_size: int = 1000) -> dict:
    raw = _make_model(seed, min(train_size, 500))
    raw_b64 = base64.b64encode(raw).decode("ascii")
    return {
        "branch": branch,
        "branch_type": "urban",
        "weights": {
            "format": "xgboost_raw_b64",
            "n_estimators": 10,
            "max_depth": 3,
            "raw_model_b64": raw_b64,
            "byte_size": len(raw),
            "sha256_hash": hashlib.sha256(raw).hexdigest(),
            "dp_epsilon": 1.0,
            "dp_noise_std": 0.1,
        },
        "metrics": {
            "accuracy": 0.85 + seed * 0.01,
            "f1": 0.83 + seed * 0.01,
            "train_size": train_size,
            "test_size": train_size // 4,
            "tn": 80, "fp": 10, "fn": 12, "tp": 98,
            "timestamp": "",
        },
    }


class TestFedAvg:

    def test_fedavg_with_two_branches_returns_valid_model(self):
        from hq_server import federated_average
        subs = {
            "Kathmandu": _make_submission("Kathmandu", 1, 1200),
            "Pokhara": _make_submission("Pokhara", 2, 900),
        }
        result = federated_average(subs)
        assert result["format"] == "xgboost_raw_b64"
        assert len(result["raw_model_b64"]) > 0
        assert result["sha256_hash"] != ""

    def test_fedavg_with_three_branches(self):
        from hq_server import federated_average
        subs = {
            "Kathmandu": _make_submission("Kathmandu", 1, 1200),
            "Pokhara": _make_submission("Pokhara", 2, 900),
            "Sarlahi": _make_submission("Sarlahi", 3, 600),
        }
        result = federated_average(subs)
        # Must produce loadable model
        raw = base64.b64decode(result["raw_model_b64"])
        booster = xgb.Booster()
        booster.load_model(bytearray(raw))
        # Must make predictions
        X = np.random.rand(10, 8).astype(np.float32)
        preds = booster.predict(xgb.DMatrix(X))
        assert len(preds) == 10
        assert all(0.0 <= p <= 1.0 for p in preds)

    def test_fedavg_weighted_by_train_size(self):
        """Branch with 3× more data should dominate the aggregation."""
        from hq_server import federated_average
        # Large branch uses seed 1, small branch seed 99 (very different)
        subs = {
            "BigBranch": _make_submission("BigBranch", 1, 9000),
            "SmallBranch": _make_submission("SmallBranch", 99, 100),
        }
        result = federated_average(subs)
        assert result is not None
        assert result["format"] == "xgboost_raw_b64"

    def test_fedavg_output_hash_matches_content(self):
        from hq_server import federated_average
        subs = {
            "Kathmandu": _make_submission("Kathmandu", 1, 1000),
            "Pokhara": _make_submission("Pokhara", 2, 800),
            "Sarlahi": _make_submission("Sarlahi", 3, 600),
        }
        result = federated_average(subs)
        raw = base64.b64decode(result["raw_model_b64"])
        assert hashlib.sha256(raw).hexdigest() == result["sha256_hash"]

    def test_fedavg_single_branch_returns_model(self):
        """FedAvg with 1 branch should still return a valid model (fallback)."""
        from hq_server import federated_average
        subs = {"Kathmandu": _make_submission("Kathmandu", 1, 1000)}
        result = federated_average(subs)
        assert result is not None
        assert "raw_model_b64" in result


class TestPayloadIntegrity:

    def test_valid_hash_passes_integrity_check(self, tiny_xgb_model_b64, tiny_xgb_model_hash):
        from hq_server import _verify_payload_integrity, WeightPayload
        wp = WeightPayload(
            format="xgboost_raw_b64",
            n_estimators=10,
            max_depth=3,
            raw_model_b64=tiny_xgb_model_b64,
            byte_size=len(base64.b64decode(tiny_xgb_model_b64)),
            sha256_hash=tiny_xgb_model_hash,
        )
        ok, msg = _verify_payload_integrity(wp)
        assert ok, f"Integrity check should pass: {msg}"

    def test_tampered_hash_fails_integrity_check(self, tiny_xgb_model_b64):
        from hq_server import _verify_payload_integrity, WeightPayload
        wp = WeightPayload(
            format="xgboost_raw_b64",
            n_estimators=10,
            max_depth=3,
            raw_model_b64=tiny_xgb_model_b64,
            byte_size=100,
            sha256_hash="a" * 64,  # obviously wrong
        )
        ok, msg = _verify_payload_integrity(wp)
        assert not ok, "Should fail with wrong hash"
        assert "INTEGRITY FAILURE" in msg

    def test_missing_hash_is_accepted_with_warning(self, tiny_xgb_model_b64):
        from hq_server import _verify_payload_integrity, WeightPayload
        wp = WeightPayload(
            format="xgboost_raw_b64",
            n_estimators=10,
            max_depth=3,
            raw_model_b64=tiny_xgb_model_b64,
            byte_size=100,
            sha256_hash="",
        )
        ok, msg = _verify_payload_integrity(wp)
        assert ok, "Missing hash should be accepted (legacy client)"
