"""
load_tests/locustfile.py — Load test for SecureScore HQ Server.

Simulates 13 bank branches registering and submitting weights concurrently.

Usage:
    pip install locust
    locust -f load_tests/locustfile.py --host http://localhost:5050

Or headless (CI):
    locust -f load_tests/locustfile.py --host http://localhost:5050 \
        --headless -u 13 -r 2 --run-time 60s \
        --csv=load_tests/results/run

Performance targets:
    - p95 latency for /api/submit_weights < 500ms
    - p99 latency for /api/register < 200ms
    - Error rate < 1%
"""

from __future__ import annotations

import os
import base64
import hashlib
import json
import random
import numpy as np

from locust import HttpUser, task, between, events


# ── Pre-built tiny model payload (built once at import time) ──
def _build_model_b64() -> tuple[str, str]:
    """Build a minimal XGBoost model. Falls back to mock bytes if xgb unavailable."""
    try:
        import xgboost as xgb
        X = np.random.rand(100, 8).astype(np.float32)
        y = (X[:, 0] > 0.5).astype(int)
        booster = xgb.train(
            {"max_depth": 2, "objective": "binary:logistic"},
            xgb.DMatrix(X, label=y),
            num_boost_round=5,
            verbose_eval=False,
        )
        raw = booster.save_raw()
    except Exception:
        raw = b"\x00" * 1024  # mock 1KB payload

    b64 = base64.b64encode(raw).decode("ascii")
    sha = hashlib.sha256(raw).hexdigest()
    return b64, sha


_MODEL_B64, _MODEL_SHA256 = _build_model_b64()

BRANCHES = [
    "Kathmandu", "Lalitpur", "Pokhara",
    "Bharatpur", "Biratnagar", "Butwal",
    "Hetauda", "Itahari", "Dharan",
    "Janakpur", "Birgunj", "Nepalgunj", "Sarlahi",
]

API_KEY = os.getenv("HQ_BRANCH_API_KEY", "test-api-key-fixture")


class BranchUser(HttpUser):
    """Simulates a single bank branch edge node."""

    wait_time = between(1, 3)

    def on_start(self):
        """Each user registers as a random branch on startup."""
        self.branch = random.choice(BRANCHES)
        self.token = None
        self._do_register()

    def _do_register(self):
        with self.client.post(
            "/api/register",
            json={
                "branch": self.branch,
                "api_key": API_KEY,
                "role": "branch_operator",
            },
            catch_response=True,
            name="/api/register",
        ) as r:
            if r.status_code == 200:
                self.token = r.json().get("token")
                r.success()
            else:
                r.failure(f"Registration failed: {r.status_code}")

    @task(5)
    def submit_weights(self):
        """Main load: submit model weights (5× more frequent than health checks)."""
        if not self.token:
            self._do_register()
            return

        train_size = random.randint(500, 2000)
        payload = {
            "branch": self.branch,
            "branch_type": random.choice(["urban", "semi_urban", "rural"]),
            "weights": {
                "format": "xgboost_raw_b64",
                "n_estimators": 100,
                "max_depth": 5,
                "raw_model_b64": _MODEL_B64,
                "byte_size": len(base64.b64decode(_MODEL_B64)),
                "sha256_hash": _MODEL_SHA256,
                "dp_epsilon": 1.0,
                "dp_noise_std": 0.1,
            },
            "metrics": {
                "accuracy": round(random.uniform(0.78, 0.95), 4),
                "f1": round(random.uniform(0.75, 0.93), 4),
                "train_size": train_size,
                "test_size": train_size // 4,
                "tn": random.randint(50, 200),
                "fp": random.randint(5, 30),
                "fn": random.randint(5, 30),
                "tp": random.randint(50, 200),
                "timestamp": "",
            },
        }

        with self.client.post(
            "/api/submit_weights",
            json=payload,
            headers={"Authorization": f"Bearer {self.token}"},
            catch_response=True,
            name="/api/submit_weights",
        ) as r:
            if r.status_code == 200:
                r.success()
            elif r.status_code == 401:
                # Token may have expired — re-register
                self._do_register()
                r.failure("Token expired, re-registering")
            else:
                r.failure(f"Submit failed: {r.status_code} — {r.text[:200]}")

    @task(1)
    def check_health(self):
        with self.client.get("/api/health", catch_response=True, name="/api/health") as r:
            if r.status_code == 200:
                r.success()
            else:
                r.failure(f"Health check failed: {r.status_code}")

    @task(1)
    def check_network_status(self):
        if not self.token:
            return
        with self.client.get(
            "/api/network_status",
            headers={"Authorization": f"Bearer {self.token}"},
            catch_response=True,
            name="/api/network_status",
        ) as r:
            if r.status_code == 200:
                r.success()
            else:
                r.failure(f"Network status failed: {r.status_code}")


class AdminUser(HttpUser):
    """Simulates a single HQ admin monitoring the federation."""

    wait_time = between(5, 15)
    weight = 1  # Much fewer admin users than branches

    def on_start(self):
        r = self.client.post("/api/register", json={
            "branch": "HQAdmin",
            "api_key": API_KEY,
            "role": "admin",
        })
        if r.status_code == 200:
            self.token = r.json()["token"]
        else:
            self.token = None

    @task(3)
    def check_round_history(self):
        if not self.token:
            return
        with self.client.get(
            "/api/round_history",
            headers={"Authorization": f"Bearer {self.token}"},
            catch_response=True,
            name="/api/round_history",
        ) as r:
            if r.status_code == 200:
                r.success()
            else:
                r.failure(f"Round history failed: {r.status_code}")

    @task(2)
    def check_model_registry(self):
        if not self.token:
            return
        with self.client.get(
            "/api/model_registry",
            headers={"Authorization": f"Bearer {self.token}"},
            catch_response=True,
            name="/api/model_registry",
        ) as r:
            if r.status_code == 200:
                r.success()
            else:
                r.failure(f"Model registry failed: {r.status_code}")

    @task(1)
    def verify_audit(self):
        if not self.token:
            return
        with self.client.get(
            "/api/audit_verify",
            headers={"Authorization": f"Bearer {self.token}"},
            catch_response=True,
            name="/api/audit_verify",
        ) as r:
            if r.status_code == 200:
                r.success()
            else:
                r.failure(f"Audit verify failed: {r.status_code}")
