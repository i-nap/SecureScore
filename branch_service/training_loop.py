"""
branch_service/training_loop.py
================================
Daily local training loop for branch edge nodes.
Trains EnsembleModel on local customer data, then uploads compressed
gradients to HQ for federated aggregation.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
import numpy as np

from .models import EnsembleModel
from .model_cache_manager import ModelCacheManager

logger = logging.getLogger(__name__)

BRANCH_ID = os.getenv("BRANCH_ID", "kathmandu")
HQ_URL = os.getenv("HQ_URL", "http://127.0.0.1:5050")
HQ_API_KEY = os.getenv("HQ_BRANCH_API_KEY", "")
TRAIN_EPOCH = int(os.getenv("TRAIN_EPOCHS", "1"))
BATCH_SIZE = int(os.getenv("TRAIN_BATCH_SIZE", "64"))
COMPRESSION_RATIO = int(os.getenv("GRADIENT_COMPRESSION_RATIO", "10"))


class BranchTrainingLoop:
    """Orchestrates daily local training and gradient upload to HQ."""

    def __init__(
        self,
        model: EnsembleModel,
        cache_manager: Optional[ModelCacheManager] = None,
    ) -> None:
        self.model = model
        self.cache_manager = cache_manager or ModelCacheManager()
        self._running = False

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    async def run_once(self, X_train: np.ndarray, y_train: np.ndarray) -> dict:
        """
        One full training cycle:
          1. Train EnsembleModel for TRAIN_EPOCH epochs
          2. Compute + compress gradients
          3. Upload compressed gradients to HQ
          4. Refresh local model cache from HQ
        Returns summary dict with metrics and upload status.
        """
        t0 = time.monotonic()

        logger.info("[TrainingLoop] Starting training — branch=%s samples=%d", BRANCH_ID, len(y_train))

        # Step 1: Train
        metrics = self.model.train(X_train, y_train, epochs=TRAIN_EPOCH, batch_size=BATCH_SIZE)
        logger.info("[TrainingLoop] Training complete — acc=%.4f auc=%.4f", metrics["accuracy"], metrics["auc"])

        # Step 2: Compute gradients
        # Sample up to 512 rows for gradient computation (efficiency)
        n = min(512, len(X_train))
        idx = np.random.choice(len(X_train), size=n, replace=False)
        gradients = self.model.compute_gradients(X_train[idx], y_train[idx])

        # Step 3: Compress
        compressed = self.model.compress_gradients(gradients, compression_ratio=COMPRESSION_RATIO)

        # Step 4: Upload to HQ
        upload_status = await self._upload_gradients(compressed, data_volume=len(y_train))

        # Step 5: Refresh HQ model cache
        if self.cache_manager:
            try:
                await self.cache_manager.daily_cache_refresh()
                logger.info("[TrainingLoop] Model cache refreshed from HQ.")
            except Exception as exc:
                logger.warning("[TrainingLoop] Cache refresh failed: %s", exc)

        elapsed = round((time.monotonic() - t0) * 1000)
        logger.info("[TrainingLoop] Cycle complete in %dms", elapsed)

        return {
            "branch_id": BRANCH_ID,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "training_accuracy": metrics["accuracy"],
            "training_auc": metrics["auc"],
            "upload_status": upload_status,
            "elapsed_ms": elapsed,
        }

    async def run_continuous(
        self,
        data_loader,
        interval_seconds: int = 86400,  # 24 h default
    ) -> None:
        """
        Infinite loop: train once, sleep interval_seconds, repeat.
        data_loader is a callable () -> (X_train, y_train).
        """
        self._running = True
        logger.info("[TrainingLoop] Continuous loop started (interval=%ds)", interval_seconds)
        while self._running:
            try:
                X_train, y_train = data_loader()
                await self.run_once(X_train, y_train)
            except Exception as exc:
                logger.error("[TrainingLoop] Error in training cycle: %s", exc, exc_info=True)
            logger.info("[TrainingLoop] Sleeping %ds until next cycle...", interval_seconds)
            await asyncio.sleep(interval_seconds)

    def stop(self) -> None:
        self._running = False
        logger.info("[TrainingLoop] Stopping continuous loop.")

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    async def _upload_gradients(self, compressed: dict, data_volume: int) -> str:
        """POST compressed gradients to HQ /api/v1/gradients/upload."""
        payload = {
            "branch_id": BRANCH_ID,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data_volume": data_volume,
            "model_version": "1.0",
            "compressed_gradients": {
                model: {
                    "indices": g["indices"].tolist() if hasattr(g.get("indices"), "tolist") else g.get("indices", []),
                    "values": g["values"].tolist() if hasattr(g.get("values"), "tolist") else g.get("values", []),
                    "shape": list(g.get("shape", [])),
                }
                for model, g in compressed.items()
            },
        }

        headers = {"X-API-Key": HQ_API_KEY, "Content-Type": "application/json"}

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(f"{HQ_URL}/api/v1/gradients/upload", json=payload, headers=headers)
                resp.raise_for_status()
                logger.info("[TrainingLoop] Gradient upload OK — status=%d", resp.status_code)
                return "success"
        except httpx.HTTPStatusError as exc:
            logger.error("[TrainingLoop] HQ upload HTTP error %d: %s", exc.response.status_code, exc.response.text)
            return f"http_error_{exc.response.status_code}"
        except Exception as exc:
            logger.error("[TrainingLoop] HQ upload failed: %s", exc)
            return "failed"
