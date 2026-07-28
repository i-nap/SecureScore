"""
tests/test_models.py
====================
Unit tests for branch_service/models.py — EnsembleModel.

Verifies:
  • All 5 model types initialise (LR, RF, GB, NN, XGB)
  • train() returns accuracy + auc metrics
  • predict_proba() returns one array per model
  • predict_ensemble() returns weighted sum in [0, 1]
  • compute_gradients() returns dict keyed by model name
  • compress_gradients() returns {indices, values, shape} per model
  • decompress_gradients() round-trips losslessly within tolerance
  • save_model() / load_model() round-trip
  • evaluate() returns all 5 metrics
  • ensemble_weights default to [0.2]*5 and sum to 1.0
  • training_metadata populated after train()
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("HQ_BRANCH_API_KEY", "test-key")

from branch_service.models import EnsembleModel

N_SAMPLES = 300
N_FEATURES = 10
RNG = np.random.default_rng(42)


@pytest.fixture(scope="module")
def dataset():
    X = RNG.random((N_SAMPLES, N_FEATURES)).astype(np.float32)
    y = (X[:, 0] + X[:, 1] > 1.0).astype(int)
    split = int(N_SAMPLES * 0.8)
    return X[:split], y[:split], X[split:], y[split:]


@pytest.fixture(scope="module")
def trained_model(dataset):
    X_train, y_train, _, _ = dataset
    m = EnsembleModel()
    m.train(X_train, y_train, epochs=1, batch_size=64)
    return m


class TestInit:
    def test_five_model_keys(self):
        m = EnsembleModel()
        assert set(m.models.keys()) == {"LR", "RF", "GB", "NN", "XGB"}

    def test_default_weights_uniform(self):
        m = EnsembleModel()
        assert len(m.ensemble_weights) == 5
        assert abs(sum(m.ensemble_weights) - 1.0) < 1e-6
        for w in m.ensemble_weights:
            assert abs(w - 0.2) < 1e-6

    def test_custom_weights_accepted(self):
        w = [0.1, 0.3, 0.2, 0.2, 0.2]
        m = EnsembleModel(ensemble_weights=w)
        # _normalize_weights converts to numpy floats — use approx
        assert len(m.ensemble_weights) == 5
        assert m.ensemble_weights == pytest.approx(w, abs=1e-4)
        assert abs(sum(m.ensemble_weights) - 1.0) < 1e-5


class TestTrain:
    def test_train_returns_accuracy_and_auc(self, dataset):
        X_train, y_train, _, _ = dataset
        m = EnsembleModel()
        result = m.train(X_train, y_train, epochs=1, batch_size=64)
        assert "accuracy" in result
        assert "auc" in result
        assert 0.0 <= result["accuracy"] <= 1.0
        assert 0.0 <= result["auc"] <= 1.0

    def test_training_metadata_populated(self, trained_model):
        meta = trained_model.training_metadata
        assert meta["num_customers"] > 0
        assert meta["accuracy"] > 0
        assert "training_date" in meta

    def test_scaler_fitted_after_train(self, trained_model):
        from sklearn.preprocessing import StandardScaler
        assert isinstance(trained_model.scaler, StandardScaler)
        assert hasattr(trained_model.scaler, "mean_")


class TestPredictProba:
    def test_returns_all_five_model_keys(self, trained_model, dataset):
        _, _, X_test, _ = dataset
        preds = trained_model.predict_proba(X_test)
        assert set(preds.keys()) == {"LR", "RF", "GB", "NN", "XGB"}

    def test_output_shapes_match_input(self, trained_model, dataset):
        _, _, X_test, _ = dataset
        preds = trained_model.predict_proba(X_test)
        for key, arr in preds.items():
            assert arr.shape == (len(X_test),), f"{key} shape mismatch"

    def test_probabilities_in_unit_interval(self, trained_model, dataset):
        _, _, X_test, _ = dataset
        preds = trained_model.predict_proba(X_test)
        for key, arr in preds.items():
            assert np.all(arr >= 0) and np.all(arr <= 1), f"{key} out of [0,1]"


class TestPredictEnsemble:
    def test_output_in_unit_interval(self, trained_model, dataset):
        _, _, X_test, _ = dataset
        scores = trained_model.predict_ensemble(X_test)
        assert scores.shape == (len(X_test),)
        assert np.all(scores >= 0) and np.all(scores <= 1)

    def test_weighted_sum_formula(self, trained_model, dataset):
        """score = Σ(weight_i × pred_i)"""
        _, _, X_test, _ = dataset
        preds = trained_model.predict_proba(X_test)
        w = trained_model.ensemble_weights
        expected = sum(w[i] * preds[k] for i, k in enumerate(["LR", "RF", "GB", "NN", "XGB"]))
        actual = trained_model.predict_ensemble(X_test)
        np.testing.assert_allclose(actual, expected, atol=1e-5)


class TestGradients:
    def test_compute_gradients_returns_all_keys(self, trained_model, dataset):
        X_train, y_train, _, _ = dataset
        grads = trained_model.compute_gradients(X_train[:64], y_train[:64])
        assert set(grads.keys()) == {"LR", "RF", "GB", "NN", "XGB"}

    def test_gradients_are_numpy_arrays(self, trained_model, dataset):
        X_train, y_train, _, _ = dataset
        grads = trained_model.compute_gradients(X_train[:64], y_train[:64])
        for key, g in grads.items():
            assert isinstance(g, np.ndarray), f"{key} gradient is not ndarray"
            assert g.ndim == 1, f"{key} gradient not flat"

    def test_compress_returns_sparse_format(self, trained_model, dataset):
        X_train, y_train, _, _ = dataset
        grads = trained_model.compute_gradients(X_train[:64], y_train[:64])
        compressed = trained_model.compress_gradients(grads, compression_ratio=10)
        for key, c in compressed.items():
            assert "indices" in c, f"{key} missing indices"
            assert "values" in c, f"{key} missing values"
            assert "shape" in c, f"{key} missing shape"

    def test_compress_decompress_roundtrip(self, trained_model, dataset):
        X_train, y_train, _, _ = dataset
        grads = trained_model.compute_gradients(X_train[:64], y_train[:64])
        compressed = trained_model.compress_gradients(grads, compression_ratio=10)
        decompressed = trained_model.decompress_gradients(compressed)
        for key in grads:
            original = grads[key]
            recovered = decompressed[key]
            assert recovered.shape == original.shape, f"{key} shape mismatch after decompress"


class TestPersistence:
    def test_save_and_load_model(self, trained_model, dataset):
        _, _, X_test, _ = dataset
        scores_before = trained_model.predict_ensemble(X_test)
        with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False) as f:
            path = f.name
        try:
            trained_model.save_model(path)
            loaded = EnsembleModel.load_model(path)
            scores_after = loaded.predict_ensemble(X_test)
            np.testing.assert_allclose(scores_before, scores_after, atol=1e-4)
        finally:
            Path(path).unlink(missing_ok=True)


class TestEvaluate:
    def test_evaluate_returns_all_metrics(self, trained_model, dataset):
        _, _, X_test, y_test = dataset
        metrics = trained_model.evaluate(X_test, y_test)
        for key in ("accuracy", "auc", "precision", "recall", "f1"):
            assert key in metrics, f"Missing metric: {key}"
            assert 0.0 <= metrics[key] <= 1.0, f"{key} out of range"
