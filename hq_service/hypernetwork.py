"""
hq_service/hypernetwork.py
==========================
Hypernetwork-based personalization for branch ensemble weights.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from typing import Dict, List

import numpy as np

try:
    import torch
    from torch import nn
except Exception:
    torch = None
    nn = None


class HypernetworkPersonalization:
    def __init__(self):
        self.trained = False
        self.hypernetwork = None

    def personalize_for_all_branches(
        self,
        aggregated_gradient: dict,
        branch_metrics: dict,
        decompressed_gradients: dict,
    ) -> dict:
        if self.hypernetwork is None:
            raise RuntimeError("Hypernetwork is not initialized")

        result = {}
        for branch_id, metrics in branch_metrics.items():
            fingerprint = self.construct_fingerprint(branch_id, metrics)
            grad_summary = self.construct_gradient_summary(
                decompressed_gradients.get(branch_id, {}),
                aggregated_gradient=aggregated_gradient,
            )
            x = np.concatenate([fingerprint, grad_summary])

            weights = self._predict_weights(x)
            if not self._passes_fairness_check(branch_id, weights):
                continue
            result[branch_id] = weights.tolist()
        return result

    def construct_fingerprint(self, branch_id: str, metrics: dict) -> np.ndarray:
        region_map = {"mountain": 0.0, "plain": 0.5, "valley": 1.0}
        region_id = region_map.get(metrics.get("region", "plain"), 0.5)

        fingerprint = [
            float(metrics.get("lat", 0.0)),
            float(metrics.get("lon", 0.0)),
            region_id,
            float(metrics.get("population_density", 0.0)),
            float(metrics.get("avg_income", 0.0)),
            float(metrics.get("num_customers", 0.0)),
            float(metrics.get("accuracy_7d", metrics.get("accuracy", 0.0))),
            float(metrics.get("default_rate_90d", metrics.get("default_rate", 0.0))),
            float(metrics.get("uptime", 0.0)),
            float(metrics.get("data_volume", 0.0)),
            float(metrics.get("latency_ms", 0.0)),
            float(metrics.get("drift_score", 0.0)),
        ]

        # Normalize to 0-1 with conservative ranges.
        ranges = [
            (-90, 90),
            (-180, 180),
            (0, 1),
            (0, 50000),
            (0, 200000),
            (0, 1000000),
            (0, 1),
            (0, 1),
            (0, 1),
            (0, 100000),
            (0, 2000),
            (0, 1),
        ]

        normed = []
        for val, (lo, hi) in zip(fingerprint, ranges):
            if hi - lo <= 0:
                normed.append(0.0)
            else:
                normed.append(max(0.0, min(1.0, (val - lo) / (hi - lo))))
        return np.asarray(normed, dtype=np.float32)

    def construct_gradient_summary(self, branch_gradients: dict, aggregated_gradient: dict | None = None) -> np.ndarray:
        if not branch_gradients:
            return np.asarray([0.0, 0.0, 0.0], dtype=np.float32)
        all_grads = []
        for g in branch_gradients.values():
            arr = np.asarray(g, dtype=np.float32).reshape(-1)
            all_grads.append(arr)
        flat = np.concatenate(all_grads) if all_grads else np.zeros(1, dtype=np.float32)
        if aggregated_gradient:
            agg = []
            for g in aggregated_gradient.values():
                agg.append(np.asarray(g, dtype=np.float32).reshape(-1))
            agg_flat = np.concatenate(agg) if agg else np.zeros_like(flat)
            min_len = min(len(flat), len(agg_flat))
            flat = flat[:min_len] - agg_flat[:min_len]
        magnitude = float(np.linalg.norm(flat))
        variance = float(np.std(flat))
        age_hours = 0.0
        return np.asarray([magnitude, variance, age_hours], dtype=np.float32)

    def train_hypernetwork(self, historical_data: list[dict]) -> None:
        if torch is None:
            raise RuntimeError("PyTorch is required to train the hypernetwork")

        X = []
        y = []
        for record in historical_data:
            fp = record.get("fingerprint")
            grads = record.get("gradients", {})
            if fp is None:
                fp = self.construct_fingerprint(record.get("branch_id", ""), record.get("metrics", {}))
            if not isinstance(fp, np.ndarray):
                fp = np.asarray(fp, dtype=np.float32)
            grad_summary = self.construct_gradient_summary(grads)
            X.append(np.concatenate([fp, grad_summary]))

            if "target_weights" in record:
                y.append(np.asarray(record["target_weights"], dtype=np.float32))
            else:
                outcome = float(record.get("outcome", 0))
                base = np.asarray([0.2] * 5, dtype=np.float32)
                bias = np.asarray([0.05, 0.1, 0.15, 0.1, -0.1], dtype=np.float32)
                y.append(np.clip(base + (outcome - 0.5) * bias, 0.01, 0.9))

        X_tensor = torch.tensor(np.asarray(X), dtype=torch.float32)
        y_tensor = torch.tensor(np.asarray(y), dtype=torch.float32)

        self.hypernetwork = nn.Linear(X_tensor.shape[1], 5)
        optimizer = torch.optim.Adam(self.hypernetwork.parameters(), lr=1e-3)

        for _ in range(50):
            optimizer.zero_grad()
            logits = self.hypernetwork(X_tensor)
            weights = torch.softmax(logits, dim=1)
            loss = torch.mean((weights - y_tensor) ** 2)
            loss.backward()
            optimizer.step()

        self.trained = True

    def load_hypernetwork(self, filepath: str) -> None:
        if torch is None:
            raise RuntimeError("torch is required to load hypernetwork")
        # Reconstruct nn.Linear from saved state_dict stored in a BytesIO buffer
        import base64, json as _json
        with open(filepath, "r", encoding="utf-8") as f:
            envelope = _json.load(f)
        n_in = envelope["n_in"]
        n_out = envelope["n_out"]
        layer = nn.Linear(n_in, n_out)
        buf = io.BytesIO(base64.b64decode(envelope["state_dict"]))
        layer.load_state_dict(torch.load(buf, weights_only=True))
        self.hypernetwork = layer
        self.trained = True

    def save_hypernetwork(self, filepath: str) -> None:
        if torch is None or self.hypernetwork is None:
            raise RuntimeError("torch hypernetwork not initialised")
        import base64, json as _json
        buf = io.BytesIO()
        torch.save(self.hypernetwork.state_dict(), buf)
        envelope = {
            "n_in": self.hypernetwork.in_features,
            "n_out": self.hypernetwork.out_features,
            "state_dict": base64.b64encode(buf.getvalue()).decode(),
        }
        with open(filepath, "w", encoding="utf-8") as f:
            _json.dump(envelope, f)

    def _predict_weights(self, x: np.ndarray) -> np.ndarray:
        if torch is None or self.hypernetwork is None:
            return np.asarray([0.2] * 5, dtype=np.float32)
        tensor = torch.tensor(x.reshape(1, -1), dtype=torch.float32)
        with torch.no_grad():
            logits = self.hypernetwork(tensor)
            weights = torch.softmax(logits, dim=1).numpy().reshape(-1)
        total = float(np.sum(weights))
        return weights / total if total > 0 else np.asarray([0.2] * 5, dtype=np.float32)

    def _passes_fairness_check(self, branch_id: str, weights: np.ndarray) -> bool:
        # Guard against extreme concentration in a single model.
        if np.any(weights < 0.05) or np.any(weights > 0.7):
            return False
        return True
