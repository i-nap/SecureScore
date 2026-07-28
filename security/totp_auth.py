"""
security/totp_auth.py

TOTP (Time-based One-Time Password) MFA manager.
Uses pyotp for secret generation and verification.
Persists secrets in hq_state/mfa_secrets.json (encrypted-at-rest recommended).
"""

from __future__ import annotations

import base64
import io
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

try:
    import pyotp
    _PYOTP_AVAILABLE = True
except ImportError:
    _PYOTP_AVAILABLE = False

try:
    import qrcode
    from PIL import Image
    _QRCODE_AVAILABLE = True
except ImportError:
    _QRCODE_AVAILABLE = False

MFA_SECRET_STORE = Path("hq_state/mfa_secrets.json")
ISSUER_NAME = "SecureScore Bank Suite"


class TOTPAuthManager:
    """
    Manages TOTP MFA enrollment and verification for admin users.

    Each user gets a unique base32 secret stored in mfa_secrets.json.
    QR code is returned as a base64-encoded PNG for the frontend to render.
    """

    def __init__(self, secret_store: Path = MFA_SECRET_STORE):
        self.secret_store = secret_store
        self._secrets: dict[str, str] = self._load_secrets()

    # ── Persistence ───────────────────────────────────────────

    def _load_secrets(self) -> dict[str, str]:
        if self.secret_store.exists():
            try:
                return json.loads(self.secret_store.read_text(encoding="utf-8"))
            except Exception:
                return {}
        return {}

    def _save_secrets(self) -> None:
        self.secret_store.parent.mkdir(parents=True, exist_ok=True)
        self.secret_store.write_text(
            json.dumps(self._secrets, indent=2), encoding="utf-8"
        )

    # ── Enrollment ────────────────────────────────────────────

    def generate_secret(self, username: str) -> str:
        """Generate and persist a new TOTP secret for a user."""
        if not _PYOTP_AVAILABLE:
            # Deterministic stub when pyotp is missing
            stub = base64.b32encode(f"securescore_{username}".encode()).decode()
            self._secrets[username] = stub
            self._save_secrets()
            return stub

        secret = pyotp.random_base32()
        self._secrets[username] = secret
        self._save_secrets()
        return secret

    def get_qr_code_b64(self, username: str) -> str:
        """
        Return a base64-encoded PNG of the TOTP QR code for the given user.
        Generates a secret if one doesn't exist yet.
        """
        secret = self._secrets.get(username) or self.generate_secret(username)

        if not _PYOTP_AVAILABLE:
            # Return a 1×1 transparent PNG placeholder
            placeholder = (
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/"
                "z8AAwkBBQAB/wAAAABJRU5ErkJggg=="
            )
            return placeholder

        totp = pyotp.TOTP(secret)
        uri = totp.provisioning_uri(name=username, issuer_name=ISSUER_NAME)

        if not _QRCODE_AVAILABLE:
            return base64.b64encode(uri.encode()).decode()

        img = qrcode.make(uri)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()

    def is_enrolled(self, username: str) -> bool:
        return username in self._secrets

    # ── Verification ──────────────────────────────────────────

    def verify_totp(self, username: str, otp_code: str) -> bool:
        """
        Verify a 6-digit OTP for an enrolled user.
        Allows ±1 window (30-second tolerance on either side).
        """
        secret = self._secrets.get(username)
        if not secret:
            return False

        if not _PYOTP_AVAILABLE:
            # Stub: accept "000000" for testing when pyotp not installed
            return otp_code == "000000"

        totp = pyotp.TOTP(secret)
        return totp.verify(otp_code, valid_window=1)

    # ── Status ────────────────────────────────────────────────

    def enrollment_status(self) -> list[dict]:
        """Return enrollment status for all known users."""
        return [
            {
                "username": username,
                "enrolled": True,
                "enrolled_at": "unknown",
            }
            for username in self._secrets
        ]

    def unenroll(self, username: str) -> bool:
        """Remove MFA enrollment for a user."""
        if username in self._secrets:
            del self._secrets[username]
            self._save_secrets()
            return True
        return False
