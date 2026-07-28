"""
branch_service/models.py
========================
EnsembleModel implementation for branch-side training and scoring.
"""

from __future__ import annotations

import base64
import io
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List

import numpy as np

from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, roc_auc_score, precision_score, recall_score, f1_score

try:
    import torch
    from torch import nn
except Exception as exc:  # pragma: no cover - optional if torch missing
    torch = None
    nn = None

try:
    from xgboost import XGBClassifier
except Exception as exc:  # pragma: no cover - optional if xgboost missing
    XGBClassifier = None


class _SimpleNN(nn.Module):
    def __init__(self, n_features: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class EnsembleModel:
    def __init__(self, ensemble_weights: List[float] | None = None, feature_names: List[str] | None = None):
        self.models: Dict[str, object] = {
            "LR": LogisticRegression(max_iter=1000),
            "RF": RandomForestClassifier(n_estimators=200, random_state=42),
            "GB": GradientBoostingClassifier(random_state=42),
            "NN": None,
            "XGB": XGBClassifier(
                n_estimators=200,
                max_depth=4,
                learning_rate=0.1,
                subsample=0.8,
                colsample_bytree=0.8,
                eval_metric="logloss",
                random_state=42,
            ) if XGBClassifier else None,
        }
        self.ensemble_weights = self._normalize_weights(ensemble_weights or [0.2] * 5)
        self.scaler = StandardScaler()
        self.feature_names = feature_names or []
        self.training_metadata: dict = {}

    def _normalize_weights(self, weights: List[float]) -> List[float]:
        if len(weights) != 5:
            raise ValueError("ensemble_weights must have length 5")
        arr = np.asarray(weights, dtype=np.float32)
        total = float(arr.sum())
        if total <= 0:
            return [0.2] * 5
        return (arr / total).tolist()

    def _ensure_nn(self, n_features: int) -> None:
        if self.models.get("NN") is None:
            if torch is None:
                raise RuntimeError("PyTorch is required for NN model")
            self.models["NN"] = _SimpleNN(n_features)

    def train(self, X_train, y_train, epochs: int = 1, batch_size: int = 64) -> dict:
        X = np.asarray(X_train)
        y = np.asarray(y_train).astype(np.float32)
        if X.ndim != 2:
            raise ValueError("X_train must be 2D")

        if not self.feature_names:
            self.feature_names = [f"f{i}" for i in range(X.shape[1])]

        X_scaled = self.scaler.fit_transform(X)

        self.models["LR"].fit(X_scaled, y)
        self.models["RF"].fit(X_scaled, y)
        self.models["GB"].fit(X_scaled, y)
        if self.models["XGB"] is None:
            raise RuntimeError("xgboost is required for XGB model")
        self.models["XGB"].fit(X_scaled, y)

        self._ensure_nn(X.shape[1])
        nn_model: _SimpleNN = self.models["NN"]
        nn_model.train()
        optim = torch.optim.Adam(nn_model.parameters(), lr=1e-3)
        loss_fn = torch.nn.BCEWithLogitsLoss()

        X_tensor = torch.tensor(X_scaled, dtype=torch.float32)
        y_tensor = torch.tensor(y.reshape(-1, 1), dtype=torch.float32)
        for _ in range(max(1, epochs)):
            for start in range(0, len(X_tensor), batch_size):
                end = start + batch_size
                xb = X_tensor[start:end]
                yb = y_tensor[start:end]
                optim.zero_grad()
                logits = nn_model(xb)
                loss = loss_fn(logits, yb)
                loss.backward()
                optim.step()

        preds = self.predict_ensemble(X)
        acc = accuracy_score(y, (preds >= 0.5).astype(int))
        try:
            auc = roc_auc_score(y, preds)
        except Exception:
            auc = 0.0

        self.training_metadata = {
            "training_date": datetime.now(timezone.utc),
            "num_customers": int(len(X)),
            "accuracy": float(acc),
            "default_rate": float(np.mean(y)),
            "num_features": int(X.shape[1]),
        }
        return {"accuracy": float(acc), "auc": float(auc)}

    def predict_proba(self, X) -> dict:
        X_arr = np.asarray(X)
        X_scaled = self.scaler.transform(X_arr)

        probs = {
            "LR": self.models["LR"].predict_proba(X_scaled)[:, 1],
            "RF": self.models["RF"].predict_proba(X_scaled)[:, 1],
            "GB": self.models["GB"].predict_proba(X_scaled)[:, 1],
            "XGB": self.models["XGB"].predict_proba(X_scaled)[:, 1],
        }

        self._ensure_nn(X_arr.shape[1])
        nn_model: _SimpleNN = self.models["NN"]
        nn_model.eval()
        with torch.no_grad():
            logits = nn_model(torch.tensor(X_scaled, dtype=torch.float32))
            probs["NN"] = torch.sigmoid(logits).numpy().reshape(-1)

        return probs

    def predict_ensemble(self, X) -> np.ndarray:
        preds = self.predict_proba(X)
        weights = np.asarray(self._normalize_weights(self.ensemble_weights), dtype=np.float32)

        ordered = [preds["LR"], preds["RF"], preds["GB"], preds["NN"], preds["XGB"]]
        stacked = np.vstack(ordered)
        return np.sum(stacked.T * weights, axis=1)

    def compute_gradients(self, X_batch, y_batch) -> dict:
        X = np.asarray(X_batch)
        y = np.asarray(y_batch).astype(np.float32)
        X_scaled = self.scaler.transform(X)

        gradients = {}

        # LR gradient
        lr = self.models["LR"]
        if not hasattr(lr, "coef_"):
            raise RuntimeError("LogisticRegression model not trained")
        w = lr.coef_.reshape(-1)
        b = float(lr.intercept_[0])
        logits = X_scaled.dot(w) + b
        preds = 1 / (1 + np.exp(-logits))
        error = preds - y
        grad_w = X_scaled.T.dot(error) / max(len(X_scaled), 1)
        grad_b = np.mean(error)
        gradients["LR"] = np.concatenate([grad_w, [grad_b]])

        # Tree-based proxy gradients (error-weighted feature importances)
        for key in ("RF", "GB", "XGB"):
            model = self.models.get(key)
            if model is None:
                gradients[key] = np.zeros(X.shape[1], dtype=np.float32)
                continue
            try:
                preds = model.predict_proba(X_scaled)[:, 1]
                error = preds - y
                loss_grad = float(np.mean(error))
            except Exception:
                loss_grad = 0.0
            if hasattr(model, "feature_importances_"):
                gradients[key] = np.asarray(model.feature_importances_, dtype=np.float32) * loss_grad
            else:
                gradients[key] = np.zeros(X.shape[1], dtype=np.float32)

        # NN gradients
        self._ensure_nn(X.shape[1])
        nn_model: _SimpleNN = self.models["NN"]
        nn_model.train()
        nn_model.zero_grad()
        logits = nn_model(torch.tensor(X_scaled, dtype=torch.float32))
        loss = torch.nn.BCEWithLogitsLoss()(logits, torch.tensor(y.reshape(-1, 1), dtype=torch.float32))
        loss.backward()
        grads = []
        for p in nn_model.parameters():
            if p.grad is not None:
                grads.append(p.grad.detach().cpu().numpy().reshape(-1))
        gradients["NN"] = np.concatenate(grads) if grads else np.zeros(1, dtype=np.float32)

        return gradients

    def compress_gradients(self, gradients: dict, compression_ratio: int = 10) -> dict:
        compressed = {}
        for name, grad in gradients.items():
            arr = np.asarray(grad, dtype=np.float32)
            flat = arr.reshape(-1)
            if flat.size == 0:
                compressed[name] = {"indices": [], "values": [], "shape": list(arr.shape), "scale": 1.0}
                continue

            max_abs = float(np.max(np.abs(flat)))
            scale = max_abs / 127.0 if max_abs > 0 else 1.0
            quant = np.round(flat / scale).astype(np.int8)

            k = max(1, int(len(quant) * (compression_ratio / 100.0)))
            top_idx = np.argpartition(np.abs(quant), -k)[-k:]
            compressed[name] = {
                "indices": top_idx.tolist(),
                "values": quant[top_idx].tolist(),
                "shape": list(arr.shape),
                "scale": scale,
            }
        return compressed

    def decompress_gradients(self, compressed: dict) -> dict:
        decompressed = {}
        for name, payload in compressed.items():
            shape = tuple(payload.get("shape", []))
            indices = payload.get("indices", [])
            values = payload.get("values", [])
            scale = payload.get("scale", 1.0)
            size = int(np.prod(shape)) if shape else 0
            flat = np.zeros(size, dtype=np.float32)
            for idx, val in zip(indices, values):
                flat[int(idx)] = float(val) * float(scale)
            decompressed[name] = flat.reshape(shape)
        return decompressed

    def save_model(self, filepath: str) -> None:
        data: dict = {
            "ensemble_weights": self.ensemble_weights,
            "feature_names": self.feature_names,
        }
        lr = self.models.get("LR")
        if lr is not None and hasattr(lr, "coef_"):
            data["LR"] = {
                "coef": lr.coef_.tolist(),
                "intercept": lr.intercept_.tolist(),
                "classes": lr.classes_.tolist() if hasattr(lr, "classes_") else [],
            }
        if hasattr(self.scaler, "mean_") and self.scaler.mean_ is not None:
            data["scaler"] = {
                "mean": self.scaler.mean_.tolist(),
                "scale": self.scaler.scale_.tolist(),
                "var": self.scaler.var_.tolist(),
                "n_features_in": int(self.scaler.n_features_in_),
            }
        xgb_clf = self.models.get("XGB")
        if xgb_clf is not None and hasattr(xgb_clf, "get_booster"):
            try:
                booster = xgb_clf.get_booster()
                model_bytes = booster.save_raw("json")
                data["XGB"] = base64.b64encode(model_bytes).decode()
                # Persist n_classes_ so predict_proba works after load.
                if hasattr(xgb_clf, "n_classes_"):
                    data["XGB_n_classes"] = int(xgb_clf.n_classes_)
            except Exception:
                pass
        nn_model = self.models.get("NN")
        if nn_model is not None and torch is not None:
            try:
                buf = io.BytesIO()
                torch.save(nn_model.state_dict(), buf)
                data["NN"] = base64.b64encode(buf.getvalue()).decode()
                data["NN_n_features"] = nn_model.net[0].in_features
            except Exception:
                pass
        # RF and GB are sklearn tree ensembles; serialized via scaler/LR state only.
        # They reinitialize as unfitted on load and re-fit on the next FL round.
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f)

    @classmethod
    def load_model(cls, filepath: str) -> "EnsembleModel":
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        model = cls(
            ensemble_weights=data.get("ensemble_weights"),
            feature_names=data.get("feature_names"),
        )
        if "LR" in data:
            lr = model.models.get("LR")
            if lr is not None:
                lr.coef_ = np.array(data["LR"]["coef"])
                lr.intercept_ = np.array(data["LR"]["intercept"])
                if data["LR"].get("classes"):
                    lr.classes_ = np.array(data["LR"]["classes"])
        if "scaler" in data:
            model.scaler.mean_ = np.array(data["scaler"]["mean"])
            model.scaler.scale_ = np.array(data["scaler"]["scale"])
            model.scaler.var_ = np.array(data["scaler"]["var"])
            model.scaler.n_features_in_ = data["scaler"]["n_features_in"]
        if "XGB" in data and XGBClassifier is not None:
            try:
                import xgboost as _xgb
                model_bytes = base64.b64decode(data["XGB"])
                booster = _xgb.Booster()
                booster.load_model(bytearray(model_bytes))
                xgb_clf = XGBClassifier()
                xgb_clf._Booster = booster
                # Restore n_classes_ so predict_proba works without a re-fit.
                n_classes = data.get("XGB_n_classes", 2)
                xgb_clf.n_classes_ = int(n_classes)
                model.models["XGB"] = xgb_clf
            except Exception:
                pass
        if "NN" in data and torch is not None:
            try:
                n_features = data.get("NN_n_features") or len(data.get("feature_names") or []) or 10
                nn_model = _SimpleNN(n_features)
                buf = io.BytesIO(base64.b64decode(data["NN"]))
                nn_model.load_state_dict(torch.load(buf, weights_only=True))
                model.models["NN"] = nn_model
            except Exception:
                pass
        return model

    def evaluate(self, X_test, y_test) -> dict:
        y_true = np.asarray(y_test).astype(int)
        scores = self.predict_ensemble(X_test)
        preds = (scores >= 0.5).astype(int)

        metrics = {
            "accuracy": float(accuracy_score(y_true, preds)),
            "precision": float(precision_score(y_true, preds, zero_division=0)),
            "recall": float(recall_score(y_true, preds, zero_division=0)),
            "f1": float(f1_score(y_true, preds, zero_division=0)),
        }
        try:
            metrics["auc"] = float(roc_auc_score(y_true, scores))
        except Exception:
            metrics["auc"] = 0.0
        return metrics
