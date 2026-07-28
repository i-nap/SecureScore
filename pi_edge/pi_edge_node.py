"""
pi_edge/pi_edge_node.py

Lightweight Pi-optimised edge node.
Thin wrapper around edge_node.py that uses PI_MODEL_CONFIG,
adds offline buffering, and reports hardware metrics.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

from pi_edge.pi_config import (
    PI_MODEL_CONFIG, OFFLINE_BUFFER_PATH, WEIGHT_BUFFER_MAX,
    HQ_HEARTBEAT_INTERVAL, PI_STATE_DIR,
)
from pi_edge.pi_hardware import get_hardware_snapshot

# Add parent dir to path so edge_node can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import edge_node

logger = logging.getLogger("pi_edge_node")


class PiEdgeNode:
    """
    Pi-optimised edge node. Uses a 30-tree, depth-3 XGBoost model
    that fits comfortably in Pi 4's 4 GB RAM.
    """

    def __init__(self, branch_name: str, hq_url: str, api_key: str):
        self.branch_name  = branch_name.lower().replace(" ", "_")
        self.hq_url       = hq_url
        self.api_key      = api_key
        self._model       = None
        self._weights_b64: Optional[str] = None
        self._metrics: dict   = {}
        self._offline_rounds: int = 0
        PI_STATE_DIR.mkdir(parents=True, exist_ok=True)
        OFFLINE_BUFFER_PATH.parent.mkdir(parents=True, exist_ok=True)

    # ── Training ──────────────────────────────────────────────

    def train_lightweight_model(self, X, y) -> tuple:
        """Train a Pi-optimised XGBoost model. Returns (model, metrics)."""
        try:
            import xgboost as xgb
            from sklearn.model_selection import train_test_split
            from sklearn.metrics import accuracy_score, f1_score

            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42,
                stratify=y if y.sum() > 5 else None,
            )
            model = xgb.XGBClassifier(**PI_MODEL_CONFIG)
            model.fit(X_train, y_train)
            preds = model.predict(X_test)
            self._model = model
            self._metrics = {
                "accuracy": round(float(accuracy_score(y_test, preds)), 4),
                "f1":       round(float(f1_score(y_test, preds, zero_division=0)), 4),
                "n_estimators": PI_MODEL_CONFIG["n_estimators"],
                "max_depth":    PI_MODEL_CONFIG["max_depth"],
            }
            return model, self._metrics
        except ImportError:
            logger.error("XGBoost not installed — cannot train Pi model")
            raise

    # ── Weight submission ─────────────────────────────────────

    def submit_weights_with_offline_fallback(self) -> bool:
        """
        Submit weights to HQ. If HQ is unreachable, buffer locally.
        Returns True if submitted successfully, False if buffered.
        """
        if self._model is None:
            logger.warning("No model trained yet")
            return False

        import base64, io
        buf = io.BytesIO()
        self._model.get_booster().save_model(buf)
        weights_b64 = base64.b64encode(buf.getvalue()).decode()
        self._weights_b64 = weights_b64

        try:
            import requests, hashlib
            raw_bytes = base64.b64decode(weights_b64)
            sha256    = hashlib.sha256(raw_bytes).hexdigest()
            payload   = {
                "branch": self.branch_name,
                "pi_device": True,
                "weights": {
                    "format": "xgboost_raw_b64",
                    "n_estimators": PI_MODEL_CONFIG["n_estimators"],
                    "max_depth":    PI_MODEL_CONFIG["max_depth"],
                    "raw_model_b64": weights_b64,
                    "byte_size": len(raw_bytes),
                    "sha256_hash": sha256,
                },
                "metrics": self._metrics,
                "submitted_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            }

            # First register to get a token
            reg_resp = requests.post(
                f"{self.hq_url}/api/register",
                json={"branch": self.branch_name, "api_key": self.api_key,
                      "role": "branch_operator"},
                timeout=10,
            )
            reg_resp.raise_for_status()
            token = reg_resp.json()["token"]

            resp = requests.post(
                f"{self.hq_url}/api/submit_weights",
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
                timeout=30,
            )
            resp.raise_for_status()
            logger.info("Weights submitted to HQ successfully")
            self._offline_rounds = 0
            return True

        except Exception as exc:
            logger.warning("HQ submission failed (%s) — buffering offline", exc)
            self._buffer_offline(weights_b64)
            return False

    def _buffer_offline(self, weights_b64: str) -> None:
        """Save weights to offline buffer for later submission."""
        buffer: list = []
        if OFFLINE_BUFFER_PATH.exists():
            try:
                buffer = json.loads(OFFLINE_BUFFER_PATH.read_text())
            except Exception:
                buffer = []

        buffer.append({
            "weights_b64": weights_b64,
            "metrics": self._metrics,
            "branch": self.branch_name,
            "buffered_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        })
        # Keep only the most recent rounds
        buffer = buffer[-WEIGHT_BUFFER_MAX:]
        OFFLINE_BUFFER_PATH.write_text(json.dumps(buffer))
        self._offline_rounds = len(buffer)
        logger.info("Buffered offline — total buffered rounds: %d", self._offline_rounds)

    def flush_offline_buffer(self) -> int:
        """Submit all buffered weight rounds when HQ reconnects. Returns count submitted."""
        if not OFFLINE_BUFFER_PATH.exists():
            return 0

        try:
            buffer = json.loads(OFFLINE_BUFFER_PATH.read_text())
        except Exception:
            return 0

        submitted = 0
        for entry in buffer:
            self._weights_b64 = entry["weights_b64"]
            self._metrics = entry["metrics"]
            if self.submit_weights_with_offline_fallback():
                submitted += 1

        if submitted == len(buffer):
            OFFLINE_BUFFER_PATH.unlink(missing_ok=True)
            self._offline_rounds = 0

        return submitted

    # ── Hardware ──────────────────────────────────────────────

    def get_hardware_metrics(self) -> dict:
        """Return current Pi hardware snapshot."""
        hw = get_hardware_snapshot()
        hw["branch"] = self.branch_name
        hw["offline_rounds"] = self._offline_rounds
        return hw

    # ── Registration ──────────────────────────────────────────

    def register_with_hq(self) -> str:
        """Register with HQ, flagging as a Pi device. Returns JWT token."""
        import requests
        resp = requests.post(
            f"{self.hq_url}/api/register",
            json={
                "branch": self.branch_name,
                "api_key": self.api_key,
                "role": "branch_operator",
                "pi_device": True,
            },
            timeout=15,
        )
        resp.raise_for_status()
        token = resp.json()["token"]
        logger.info("Registered with HQ — token issued")
        return token

    # ── Heartbeat ─────────────────────────────────────────────

    def send_heartbeat(self, token: str) -> bool:
        """
        POST /api/pi_heartbeat to HQ with hardware metrics.
        Returns True on success, False if HQ is unreachable.
        """
        import requests
        hw = get_hardware_snapshot()
        payload = {
            "branch": self.branch_name,
            "offline_rounds": self._offline_rounds,
            "hardware": hw,
            "pi_config": PI_MODEL_CONFIG,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            resp = requests.post(
                f"{self.hq_url}/api/pi_heartbeat",
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            if resp.status_code == 401:
                # Token expired — caller should re-register
                return False
            resp.raise_for_status()
            logger.debug("Heartbeat sent to HQ — branch=%s", self.branch_name)
            return True
        except Exception as exc:
            logger.warning("Heartbeat failed: %s", exc)
            return False

    async def run_heartbeat_loop(self) -> None:
        """
        Async loop: register once, then send a heartbeat every
        HQ_HEARTBEAT_INTERVAL seconds. Re-registers automatically
        when the token expires (send_heartbeat returns False).
        Call this as an asyncio task from pi_api startup.
        """
        token = ""
        while True:
            try:
                if not token:
                    token = await asyncio.to_thread(self.register_with_hq)
                ok = await asyncio.to_thread(self.send_heartbeat, token)
                if not ok:
                    logger.info("Heartbeat got 401 — re-registering")
                    token = ""
            except Exception as exc:
                logger.warning("Heartbeat loop error: %s — retrying", exc)
                token = ""
            await asyncio.sleep(HQ_HEARTBEAT_INTERVAL)
