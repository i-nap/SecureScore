"""
branch_service/model_cache_manager.py
====================================
Handles cached HQ models + branch weights with rollback support.
"""

from __future__ import annotations

import json
import os
import shutil
import logging
from datetime import datetime, timedelta
from pathlib import Path

try:
    import httpx
except Exception:
    httpx = None

from branch_service.models import EnsembleModel


class ModelCacheManager:
    def __init__(
        self,
        cache_dir: str,
        backup_dir: str,
        hq_base_url: str,
        branch_id: str,
        local_fallback: EnsembleModel | None = None,
    ):
        self.cache_dir = Path(cache_dir)
        self.backup_dir = Path(backup_dir)
        self.hq_base_url = hq_base_url.rstrip("/")
        self.branch_id = branch_id
        self.local_fallback = local_fallback
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        self.logger = logging.getLogger("branch.cache")

    async def daily_cache_refresh(self) -> None:
        if httpx is None:
            raise RuntimeError("httpx is required for cache refresh")

        backup_path = self.backup_cache()
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                model_resp = await client.get(f"{self.hq_base_url}/models/global/latest")
                model_resp.raise_for_status()
                weights_resp = await client.get(
                    f"{self.hq_base_url}/weights/branch/{self.branch_id}/latest"
                )
                weights_resp.raise_for_status()

            model_path = self.cache_dir / "hq_global_model.json"
            model_path.write_bytes(model_resp.content)
            weights_path = self.cache_dir / f"branch_weights_{self.branch_id}.json"
            weights_path.write_bytes(weights_resp.content)

            model = EnsembleModel.load_model(str(model_path))
            if not self._validate_model(model):
                raise ValueError("Model validation failed")
            self.logger.info("Cache refresh complete")
        except Exception:
            self.logger.exception("Cache refresh failed; restoring backup")
            self.restore_from_backup(backup_path)
            raise

    def load_cached_global_model(self) -> EnsembleModel | None:
        try:
            return self._load_model_json(self.cache_dir / "hq_global_model.json")
        except Exception:
            try:
                latest = self._latest_backup_dir()
                if latest is None:
                    raise FileNotFoundError("No backup")
                return self._load_model_json(latest / "hq_global_model.json")
            except Exception:
                if self.local_fallback is not None:
                    self.logger.warning("Falling back to local model")
                    return self.local_fallback
                return None

    def load_cached_personalized_weights(self, branch_id: str) -> list[float]:
        path = self.cache_dir / f"branch_weights_{branch_id}.json"
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return [0.2] * 5

    def _load_model_json(self, path: Path) -> EnsembleModel:
        return EnsembleModel.load_model(str(path))

    def load_from_cache(self, key: str):
        path = self.cache_dir / f"{key}.json"
        if key == "hq_global_model":
            return self._load_model_json(path)
        return json.loads(path.read_text(encoding="utf-8"))

    def load_from_backup(self, key: str):
        latest = self._latest_backup_dir()
        if latest is None:
            raise FileNotFoundError("No backup directory available")
        path = latest / f"{key}.json"
        if key == "hq_global_model":
            return self._load_model_json(path)
        return json.loads(path.read_text(encoding="utf-8"))

    def save_to_cache(self, key: str, data) -> None:
        path = self.cache_dir / f"{key}.json"
        if isinstance(data, EnsembleModel):
            data.save_model(str(path))
        else:
            path.write_text(json.dumps(data), encoding="utf-8")

    def backup_cache(self) -> Path:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = self.backup_dir / ts
        shutil.copytree(self.cache_dir, backup_path, dirs_exist_ok=True)
        self._clean_old_backups(days=7)
        return backup_path

    def restore_from_backup(self, backup_path: Path | None = None) -> None:
        src = backup_path or self._latest_backup_dir()
        if src is None:
            return
        shutil.copytree(src, self.cache_dir, dirs_exist_ok=True)

    def _latest_backup_dir(self) -> Path | None:
        backups = [p for p in self.backup_dir.iterdir() if p.is_dir()]
        if not backups:
            return None
        return max(backups, key=lambda p: p.stat().st_mtime)

    def _clean_old_backups(self, days: int = 7) -> None:
        cutoff = datetime.now() - timedelta(days=days)
        for path in self.backup_dir.iterdir():
            if path.is_dir() and datetime.fromtimestamp(path.stat().st_mtime) < cutoff:
                shutil.rmtree(path, ignore_errors=True)

    def _validate_model(self, model: EnsembleModel) -> bool:
        try:
            dummy = [[0.0] * len(model.feature_names or [0] * 5)]
            model.predict_ensemble(dummy)
            return True
        except Exception:
            return False
