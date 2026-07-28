"""
tests/unit/test_serialization.py — Regression tests for the pickle → JSON migration.

CRITICAL: Run these before any FL round to confirm that no code path creates .pkl
files and that all model artefacts round-trip faithfully through JSON + base64.
See CLAUDE.md Section 25.9.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sys
from pathlib import Path

import numpy as np
import pytest

os.environ.setdefault("HQ_BRANCH_API_KEY", "test-api-key-fixture")
os.environ.setdefault("HQ_SECRET_KEY", "test-jwt-secret-fixture-32chars!!")

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

try:
    import xgboost as xgb
    HAS_XGB = True
except ImportError:
    HAS_XGB = False

try:
    import torch
    import torch.nn as nn
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False

# ── EnsembleModel imports ──────────────────────────────────────────────────────

try:
    from branch_service.models import EnsembleModel
    HAS_ENSEMBLE = True
except ImportError:
    HAS_ENSEMBLE = False

# ── HypernetworkPersonalization imports ───────────────────────────────────────

try:
    from hq_service.hypernetwork import HypernetworkPersonalization
    HAS_HYPERNETWORK = True
except ImportError:
    HAS_HYPERNETWORK = False


# ═══════════════════════════════════════════════════════════════════════════════
#  XGBoost native JSON serialisation contract (CLAUDE.md §10.2)
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not HAS_XGB, reason="xgboost not installed")
def test_xgboost_save_raw_roundtrip(tmp_path):
    """Booster saved with save_raw('json') round-trips identically."""
    import xgboost as xgb_mod
    rng = np.random.default_rng(42)
    X = rng.random((50, 5)).astype(np.float32)
    y = (X[:, 0] > 0.5).astype(np.float32)

    booster = xgb_mod.train(
        {"n_estimators": 5, "max_depth": 2, "verbosity": 0},
        xgb_mod.DMatrix(X, label=y),
        num_boost_round=5,
    )

    # Save
    model_bytes: bytes = booster.save_raw("json")
    b64_str: str = base64.b64encode(model_bytes).decode()
    sha256: str = hashlib.sha256(model_bytes).hexdigest()

    # Load
    decoded_bytes = base64.b64decode(b64_str)
    assert hashlib.sha256(decoded_bytes).hexdigest() == sha256

    loaded = xgb_mod.Booster()
    loaded.load_model(bytearray(decoded_bytes))

    # Predictions must match exactly
    preds_orig = booster.predict(xgb_mod.DMatrix(X))
    preds_load = loaded.predict(xgb_mod.DMatrix(X))
    np.testing.assert_array_equal(preds_orig, preds_load)


@pytest.mark.skipif(not HAS_XGB, reason="xgboost not installed")
def test_xgboost_no_pkl_file(tmp_path):
    """The XGBoost serialisation path must never create a .pkl file."""
    import xgboost as xgb_mod
    rng = np.random.default_rng(0)
    X = rng.random((20, 3)).astype(np.float32)
    y = (X[:, 0] > 0.5).astype(np.float32)
    booster = xgb_mod.train({"verbosity": 0}, xgb_mod.DMatrix(X, label=y), num_boost_round=2)

    model_bytes = booster.save_raw("json")
    payload_path = tmp_path / "weights.json"
    payload_path.write_text(json.dumps({
        "raw_model_b64": base64.b64encode(model_bytes).decode(),
        "sha256_hash": hashlib.sha256(model_bytes).hexdigest(),
    }))

    assert not list(tmp_path.glob("*.pkl")), "save_raw path must not produce .pkl files"


# ═══════════════════════════════════════════════════════════════════════════════
#  EnsembleModel JSON serialisation
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not HAS_ENSEMBLE, reason="branch_service not importable")
def test_ensemble_model_lr_roundtrip(tmp_path):
    """LR coef/intercept survive save_model → load_model."""
    model = EnsembleModel()
    lr = model.models.get("LR")
    if lr is None:
        pytest.skip("EnsembleModel has no LR sub-model")

    lr.coef_ = np.array([[0.1, -0.2, 0.3]])
    lr.intercept_ = np.array([0.05])
    lr.classes_ = np.array([0, 1])

    path = str(tmp_path / "model.json")
    model.save_model(path)

    loaded = EnsembleModel.load_model(path)
    loaded_lr = loaded.models.get("LR")
    assert loaded_lr is not None, "LR model missing after load"
    np.testing.assert_allclose(loaded_lr.coef_, lr.coef_)
    np.testing.assert_allclose(loaded_lr.intercept_, lr.intercept_)
    np.testing.assert_array_equal(loaded_lr.classes_, lr.classes_)


@pytest.mark.skipif(not HAS_ENSEMBLE, reason="branch_service not importable")
def test_ensemble_model_scaler_roundtrip(tmp_path):
    """StandardScaler params survive save_model → load_model."""
    from sklearn.preprocessing import StandardScaler

    model = EnsembleModel()
    model.scaler = StandardScaler()
    model.scaler.mean_ = np.array([1.0, 2.0, 3.0])
    model.scaler.scale_ = np.array([0.5, 1.0, 1.5])
    model.scaler.var_ = np.array([0.25, 1.0, 2.25])
    model.scaler.n_features_in_ = 3

    path = str(tmp_path / "model_scaler.json")
    model.save_model(path)

    loaded = EnsembleModel.load_model(path)
    np.testing.assert_allclose(loaded.scaler.mean_, model.scaler.mean_)
    np.testing.assert_allclose(loaded.scaler.scale_, model.scaler.scale_)
    np.testing.assert_allclose(loaded.scaler.var_, model.scaler.var_)
    assert loaded.scaler.n_features_in_ == 3


@pytest.mark.skipif(not HAS_ENSEMBLE, reason="branch_service not importable")
def test_ensemble_model_no_pkl_file(tmp_path):
    """save_model must not create any .pkl file."""
    model = EnsembleModel()
    model.save_model(str(tmp_path / "model.json"))
    assert not list(tmp_path.glob("*.pkl")), "save_model must not produce .pkl files"


@pytest.mark.skipif(not HAS_ENSEMBLE or not HAS_XGB, reason="branch_service or xgboost not available")
def test_ensemble_model_xgb_roundtrip(tmp_path):
    """XGBoost sub-model inside EnsembleModel round-trips via base64 JSON."""
    from xgboost import XGBClassifier
    import xgboost as xgb_mod

    model = EnsembleModel()

    # Fit a minimal XGBClassifier and attach it.
    rng = np.random.default_rng(7)
    X = rng.random((40, 5)).astype(np.float32)
    y = (X[:, 0] > 0.5).astype(int)
    clf = XGBClassifier(n_estimators=3, max_depth=2, verbosity=0)
    clf.fit(X, y)
    model.models["XGB"] = clf

    path = str(tmp_path / "model_xgb.json")
    model.save_model(path)

    loaded = EnsembleModel.load_model(path)
    xgb_loaded = loaded.models.get("XGB")
    assert xgb_loaded is not None, "XGB model missing after load"

    # Predictions must be identical.
    preds_orig = clf.predict_proba(X)
    preds_load = xgb_loaded.predict_proba(X)
    np.testing.assert_allclose(preds_orig, preds_load, atol=1e-5)


# ═══════════════════════════════════════════════════════════════════════════════
#  Aggregated gradient JSON round-trip
# ═══════════════════════════════════════════════════════════════════════════════

def test_aggregated_gradients_json_roundtrip(tmp_path):
    """Aggregated numpy dict survives JSON serialisation."""
    grads = {
        "LR": np.array([0.1, 0.2, 0.3]),
        "NN": np.array([0.01, 0.02]),
        "XGB_leaf": np.array([0.5, -0.3, 0.8, 0.1]),
    }
    path = tmp_path / "grads.json"
    serializable = {k: v.tolist() for k, v in grads.items()}
    path.write_text(json.dumps(serializable))

    loaded = {k: np.array(v) for k, v in json.loads(path.read_text()).items()}
    for key, original in grads.items():
        np.testing.assert_allclose(loaded[key], original)


def test_branch_weights_json_roundtrip(tmp_path):
    """Branch weight submission payload survives JSON round-trip with integrity check."""
    import hmac

    rng = np.random.default_rng(99)
    fake_weights = rng.random(128).tolist()

    payload_str = json.dumps({"weights": fake_weights})
    payload_bytes = payload_str.encode()
    sha256 = hashlib.sha256(payload_bytes).hexdigest()

    path = tmp_path / "submission.json"
    path.write_text(json.dumps({"raw": payload_str, "sha256": sha256}))

    envelope = json.loads(path.read_text())
    actual_hash = hashlib.sha256(envelope["raw"].encode()).hexdigest()
    assert hmac.compare_digest(actual_hash, envelope["sha256"]), \
        "Payload integrity check failed — sha256 mismatch"

    recovered = json.loads(envelope["raw"])["weights"]
    np.testing.assert_allclose(np.array(recovered), np.array(fake_weights))


# ═══════════════════════════════════════════════════════════════════════════════
#  HypernetworkPersonalization JSON serialisation
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not HAS_HYPERNETWORK or not HAS_TORCH, reason="hypernetwork or torch not available")
def test_hypernetwork_roundtrip(tmp_path):
    """Hypernetwork state_dict survives save_hypernetwork → load_hypernetwork."""
    hp = HypernetworkPersonalization()
    hp.hypernetwork = torch.nn.Linear(10, 5)
    hp.trained = True

    path = str(tmp_path / "hp.json")
    hp.save_hypernetwork(path)

    hp2 = HypernetworkPersonalization()
    hp2.load_hypernetwork(path)

    assert hp2.trained is True
    assert hp2.hypernetwork is not None

    for p1, p2 in zip(hp.hypernetwork.parameters(), hp2.hypernetwork.parameters()):
        torch.testing.assert_close(p1, p2)


@pytest.mark.skipif(not HAS_HYPERNETWORK or not HAS_TORCH, reason="hypernetwork or torch not available")
def test_hypernetwork_no_pkl_file(tmp_path):
    """save_hypernetwork must not create any .pkl file."""
    hp = HypernetworkPersonalization()
    hp.hypernetwork = torch.nn.Linear(8, 4)
    hp.save_hypernetwork(str(tmp_path / "hp.json"))
    assert not list(tmp_path.glob("*.pkl")), "save_hypernetwork must not produce .pkl files"


@pytest.mark.skipif(not HAS_HYPERNETWORK or not HAS_TORCH, reason="hypernetwork or torch not available")
def test_hypernetwork_saved_file_is_valid_json(tmp_path):
    """save_hypernetwork output must be parseable JSON, not binary pickle."""
    hp = HypernetworkPersonalization()
    hp.hypernetwork = torch.nn.Linear(6, 3)
    path = tmp_path / "hp.json"
    hp.save_hypernetwork(str(path))

    content = path.read_text(encoding="utf-8")
    parsed = json.loads(content)  # raises if not valid JSON
    assert "state_dict" in parsed
    assert "n_in" in parsed
    assert "n_out" in parsed
    # state_dict value must be a base64 string, not raw bytes
    assert isinstance(parsed["state_dict"], str)
    base64.b64decode(parsed["state_dict"])  # raises if not valid base64


# ═══════════════════════════════════════════════════════════════════════════════
#  No pickle imports anywhere in service code
# ═══════════════════════════════════════════════════════════════════════════════

def test_no_pickle_import_in_service_files():
    """
    Scan all service Python files for 'import pickle'. None must be found.
    This is a hard ban — see CLAUDE.md §6.1 and §22.
    """
    root = Path(__file__).resolve().parents[2]
    service_dirs = [
        root / "hq_service",
        root / "branch_service",
        root / "shared",
        root / "security",
        root / "models",
    ]
    service_files = [root / "hq_server.py", root / "bff_gateway.py",
                     root / "edge_api.py", root / "edge_node.py"]

    violations: list[str] = []
    for d in service_dirs:
        if d.exists():
            for f in d.rglob("*.py"):
                text = f.read_text(encoding="utf-8", errors="replace")
                if "import pickle" in text:
                    violations.append(str(f.relative_to(root)))

    for f in service_files:
        if f.exists():
            text = f.read_text(encoding="utf-8", errors="replace")
            if "import pickle" in text:
                violations.append(str(f.relative_to(root)))

    assert not violations, (
        f"'import pickle' found in service files (absolute ban):\n"
        + "\n".join(f"  {v}" for v in violations)
    )


def test_no_joblib_import_in_service_files():
    """
    Scan service files for 'joblib' (another pickle-based serialiser).
    Must not appear in any model save/load path.
    """
    root = Path(__file__).resolve().parents[2]
    service_dirs = [root / "hq_service", root / "branch_service", root / "models"]

    violations: list[str] = []
    for d in service_dirs:
        if d.exists():
            for f in d.rglob("*.py"):
                text = f.read_text(encoding="utf-8", errors="replace")
                if "joblib" in text and "dump" in text:
                    violations.append(str(f.relative_to(root)))

    assert not violations, (
        "joblib serialisation found in service model files:\n"
        + "\n".join(f"  {v}" for v in violations)
    )
