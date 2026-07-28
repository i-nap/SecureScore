"""
conftest.py — Shared pytest fixtures for SecureScore test suite.
"""

from __future__ import annotations

import os
import sys
import json
import base64
import hashlib
import tempfile
import threading
from pathlib import Path
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

import pytest
import numpy as np

# ── Ensure project root is importable ──────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

# ── Set required env vars BEFORE importing project modules ─
os.environ.setdefault("HQ_BRANCH_API_KEY", "test-api-key-fixture")
os.environ.setdefault("HQ_SECRET_KEY", "test-jwt-secret-fixture-32chars!!")
os.environ.setdefault("BFF_SECRET_KEY", "test-bff-secret-fixture-32chars!!")
os.environ.setdefault("DP_EPSILON", "1.0")
os.environ.setdefault("DP_CLIP_NORM", "1.0")
os.environ.setdefault("HQ_BYZANTINE_SIGMA", "2.0")


# ═══════════════════════════════════════════════════════════
#          FIXTURES: JWT / AUTH
# ═══════════════════════════════════════════════════════════

@pytest.fixture(scope="session")
def jwt_secret() -> str:
    return os.environ["HQ_SECRET_KEY"]


@pytest.fixture(scope="session")
def branch_api_key() -> str:
    return os.environ["HQ_BRANCH_API_KEY"]


def _make_jwt(branch: str, role: str, secret: str, expired: bool = False) -> str:
    """Helper: hand-craft a JWT without importing hq_server."""
    now = datetime.now(timezone.utc)
    if expired:
        exp = now - timedelta(hours=1)
    else:
        exp = now + timedelta(hours=24)

    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    ).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({
            "branch": branch,
            "role": role,
            "iat": int(now.timestamp()),
            "exp": int(exp.timestamp()),
        }).encode()
    ).rstrip(b"=").decode()
    import hmac as _hmac
    sig_input = f"{header}.{payload}".encode()
    sig = base64.urlsafe_b64encode(
        _hmac.new(secret.encode(), sig_input, hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    return f"{header}.{payload}.{sig}"


@pytest.fixture
def admin_token(jwt_secret) -> str:
    return _make_jwt("HQ", "admin", jwt_secret)


@pytest.fixture
def branch_token(jwt_secret) -> str:
    return _make_jwt("Kathmandu", "branch_operator", jwt_secret)


@pytest.fixture
def expired_token(jwt_secret) -> str:
    return _make_jwt("Kathmandu", "branch_operator", jwt_secret, expired=True)


# ═══════════════════════════════════════════════════════════
#          FIXTURES: XGBOOST MODEL
# ═══════════════════════════════════════════════════════════

@pytest.fixture(scope="session")
def tiny_xgb_model_b64() -> str:
    """Train a tiny XGBoost model and return its base64-encoded bytes."""
    try:
        import xgboost as xgb
        X = np.random.rand(200, 8).astype(np.float32)
        y = (X[:, 0] + X[:, 1] > 1.0).astype(int)
        dtrain = xgb.DMatrix(X, label=y)
        params = {
            "max_depth": 3,
            "n_estimators": 10,
            "objective": "binary:logistic",
            "eval_metric": "logloss",
        }
        booster = xgb.train(params, dtrain, num_boost_round=10, verbose_eval=False)
        raw = booster.save_raw()
        return base64.b64encode(raw).decode("ascii")
    except ImportError:
        # Return a placeholder if xgboost not installed in test env
        return base64.b64encode(b"PLACEHOLDER_MODEL").decode("ascii")


@pytest.fixture(scope="session")
def tiny_xgb_model_hash(tiny_xgb_model_b64) -> str:
    raw = base64.b64decode(tiny_xgb_model_b64)
    return hashlib.sha256(raw).hexdigest()


# ═══════════════════════════════════════════════════════════
#          FIXTURES: TEMP DIRECTORIES
# ═══════════════════════════════════════════════════════════

@pytest.fixture
def tmp_hq_state(tmp_path) -> Path:
    """Isolated HQ state directory for each test."""
    state_dir = tmp_path / "hq_state"
    state_dir.mkdir()
    (state_dir / "registry").mkdir()
    (state_dir / "audit").mkdir()
    return state_dir


# ═══════════════════════════════════════════════════════════
#          FIXTURES: FAKE SUBMISSIONS
# ═══════════════════════════════════════════════════════════

@pytest.fixture
def fake_submission(tiny_xgb_model_b64, tiny_xgb_model_hash) -> dict:
    return {
        "branch": "Kathmandu",
        "branch_type": "urban",
        "weights": {
            "format": "xgboost_raw_b64",
            "n_estimators": 10,
            "max_depth": 3,
            "raw_model_b64": tiny_xgb_model_b64,
            "byte_size": len(base64.b64decode(tiny_xgb_model_b64)),
            "sha256_hash": tiny_xgb_model_hash,
            "dp_epsilon": 1.0,
            "dp_noise_std": 0.1,
        },
        "metrics": {
            "accuracy": 0.87,
            "f1": 0.85,
            "train_size": 1200,
            "test_size": 300,
            "tn": 100, "fp": 10, "fn": 15, "tp": 120,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    }
