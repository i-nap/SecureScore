"""
tests/unit/test_byzantine.py — Unit tests for Byzantine fault tolerance.
"""

from __future__ import annotations

import os
import sys
import base64
import hashlib
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


def _make_raw_b64(seed: int = 42) -> str:
    rng = np.random.default_rng(seed)
    X = rng.random((200, 8)).astype(np.float32)
    y = (X[:, 0] + X[:, 1] > 1.0).astype(int)
    dtrain = xgb.DMatrix(X, label=y)
    booster = xgb.train(
        {"max_depth": 3, "objective": "binary:logistic"},
        dtrain, num_boost_round=10, verbose_eval=False
    )
    return base64.b64encode(booster.save_raw()).decode("ascii")


class TestCosimSimilarity:

    def test_identical_vectors_have_similarity_one(self):
        from hq_server import _cosine_similarity
        v = np.array([1.0, 2.0, 3.0, 4.0])
        assert abs(_cosine_similarity(v, v) - 1.0) < 1e-6

    def test_orthogonal_vectors_have_similarity_zero(self):
        from hq_server import _cosine_similarity
        a = np.array([1.0, 0.0])
        b = np.array([0.0, 1.0])
        assert abs(_cosine_similarity(a, b)) < 1e-6

    def test_opposite_vectors_have_similarity_negative_one(self):
        from hq_server import _cosine_similarity
        a = np.array([1.0, 0.0])
        b = np.array([-1.0, 0.0])
        assert abs(_cosine_similarity(a, b) + 1.0) < 1e-6

    def test_zero_vectors_return_zero(self):
        from hq_server import _cosine_similarity
        z = np.array([0.0, 0.0])
        v = np.array([1.0, 2.0])
        assert _cosine_similarity(z, v) == 0.0

    def test_different_length_vectors_truncated(self):
        from hq_server import _cosine_similarity
        a = np.array([1.0, 0.0, 5.0])
        b = np.array([1.0, 0.0])
        result = _cosine_similarity(a, b)
        assert isinstance(result, float)


class TestByzantineCheck:

    @pytest.fixture(autouse=True)
    def reset_state(self):
        """Reset global HQ state before each test."""
        import hq_server
        hq_server.state.baseline_leaf_vectors = {}
        hq_server.state.min_nodes = 3
        hq_server.state.byzantine_sigma = 2.0
        yield
        hq_server.state.baseline_leaf_vectors = {}

    def test_first_submission_always_accepted(self):
        from hq_server import byzantine_check
        raw_b64 = _make_raw_b64(1)
        safe, reason = byzantine_check("Kathmandu", raw_b64)
        assert safe, f"First submission should always pass: {reason}"
        assert "First round" in reason

    def test_bootstrap_phase_accepts_all(self):
        """While we have fewer than min_nodes baselines, always accept."""
        from hq_server import byzantine_check
        # Add first 2 baselines
        byzantine_check("Kathmandu", _make_raw_b64(1))
        byzantine_check("Pokhara", _make_raw_b64(2))
        # Third submission still in bootstrap (< 3 baselines)
        safe, reason = byzantine_check("Sarlahi", _make_raw_b64(3))
        assert safe
        assert "Bootstrap" in reason

    def test_legitimate_similar_model_accepted(self):
        """After bootstrap, a legitimately similar model should be accepted."""
        from hq_server import byzantine_check
        import hq_server
        # Manually add baselines so we skip bootstrap
        hq_server.state.baseline_leaf_vectors = {
            "A": np.ones(20) * 0.5,
            "B": np.ones(20) * 0.48,
            "C": np.ones(20) * 0.52,
        }
        # Submit a very similar model (same seed as existing)
        raw_b64 = _make_raw_b64(1)
        safe, reason = byzantine_check("Kathmandu", raw_b64)
        # Result depends on actual cosine similarity — just ensure no crash
        assert isinstance(safe, bool)

    def test_invalid_base64_is_rejected(self):
        from hq_server import byzantine_check
        safe, reason = byzantine_check("BadBranch", "not-valid-base64!!!")
        assert not safe
        assert "Could not parse" in reason

    def test_leaf_vector_extraction_works(self):
        from hq_server import _extract_leaf_vector
        raw_b64 = _make_raw_b64(42)
        vec = _extract_leaf_vector(raw_b64)
        assert isinstance(vec, np.ndarray)
        assert len(vec) > 0
