"""
security/jwt_rotation.py

JWT secret rotation with previous-key grace period.
Allows in-flight tokens signed with the old key to remain valid
for one rotation cycle after rotation.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

try:
    import jwt as pyjwt
    _JWT_AVAILABLE = True
except ImportError:
    _JWT_AVAILABLE = False

ROTATION_INTERVAL_HOURS = 24
ALGORITHM = "HS256"


class JWTKeyManager:
    """
    Maintains current and previous JWT signing secrets.
    Rotates on schedule; verifies with fallback to previous key.
    """

    def __init__(
        self,
        initial_secret: str = "",
        rotation_interval_hours: int = ROTATION_INTERVAL_HOURS,
    ):
        self._current_secret = initial_secret or self._new_secret()
        self._previous_secret: Optional[str] = None
        self._rotation_interval = timedelta(hours=rotation_interval_hours)
        now = datetime.now(timezone.utc)
        self._last_rotation = now
        self._next_rotation = now + self._rotation_interval
        self._rotation_log: list[dict] = [{
            "event": "initialized",
            "timestamp": now.isoformat() + "Z",
        }]

    # ── Key management ────────────────────────────────────────

    @staticmethod
    def _new_secret() -> str:
        return secrets.token_hex(32)

    def rotate(self) -> str:
        """Rotate to a new secret. Archives current as previous."""
        self._previous_secret = self._current_secret
        self._current_secret  = self._new_secret()
        now = datetime.now(timezone.utc)
        self._last_rotation = now
        self._next_rotation = now + self._rotation_interval
        self._rotation_log.append({
            "event":     "rotated",
            "timestamp": now.isoformat() + "Z",
        })
        return self._current_secret

    def get_current_secret(self) -> str:
        return self._current_secret

    # ── Token verification ────────────────────────────────────

    def sign_token(self, payload: dict) -> str:
        """Sign a JWT payload with the current secret."""
        if not _JWT_AVAILABLE:
            # Stub: return base64 of payload
            import base64, json
            return base64.b64encode(json.dumps(payload).encode()).decode()
        return pyjwt.encode(payload, self._current_secret, algorithm=ALGORITHM)

    def verify_with_fallback(self, token: str) -> dict:
        """
        Verify a token using the current key first, then the previous key
        (grace period for tokens issued before last rotation).
        Raises jwt.InvalidTokenError if both fail.
        """
        if not _JWT_AVAILABLE:
            import base64, json
            try:
                return json.loads(base64.b64decode(token).decode())
            except Exception:
                raise ValueError("Invalid token (pyjwt not installed)")

        secrets_to_try = [self._current_secret]
        if self._previous_secret:
            secrets_to_try.append(self._previous_secret)

        last_exc = None
        for secret in secrets_to_try:
            try:
                return pyjwt.decode(token, secret, algorithms=[ALGORITHM])
            except pyjwt.InvalidTokenError as exc:
                last_exc = exc
        raise last_exc  # type: ignore[misc]

    # ── Scheduling ────────────────────────────────────────────

    def schedule_rotation(self, scheduler) -> None:
        """Register an APScheduler interval job for automatic rotation."""
        hours = int(self._rotation_interval.total_seconds() / 3600)
        scheduler.add_job(
            self.rotate,
            trigger="interval", hours=hours,
            id="jwt_key_rotation", replace_existing=True,
        )

    # ── Status properties ─────────────────────────────────────

    @property
    def last_rotation_iso(self) -> str:
        return self._last_rotation.isoformat() + "Z"

    @property
    def next_rotation_iso(self) -> str:
        return self._next_rotation.isoformat() + "Z"

    @property
    def rotation_interval_hours(self) -> int:
        return int(self._rotation_interval.total_seconds() / 3600)

    def status(self) -> dict:
        return {
            "last_rotation":      self.last_rotation_iso,
            "next_rotation":      self.next_rotation_iso,
            "interval_hours":     self.rotation_interval_hours,
            "has_previous_key":   self._previous_secret is not None,
            "rotation_count":     len([e for e in self._rotation_log if e["event"] == "rotated"]),
            "rotation_log":       self._rotation_log[-10:],
        }
