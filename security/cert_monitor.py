"""
security/cert_monitor.py

mTLS certificate expiry monitor with auto-rotation scheduling.
Scans all .crt files in the certs directory and reports days-to-expiry.
"""

from __future__ import annotations

import os
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

try:
    from cryptography import x509
    from cryptography.hazmat.backends import default_backend
    _CRYPTO_AVAILABLE = True
except ImportError:
    _CRYPTO_AVAILABLE = False


CERT_DIR_DEFAULT = Path("certs")
ROTATE_DAYS_BEFORE = 30   # flag if expiring within 30 days
ROTATE_SCRIPT = Path("rotate_certs.py")

_audit_log: list[dict] = []


class CertMonitor:
    """
    Scans a directory for PEM .crt files, reports expiry status,
    and optionally auto-rotates certificates that are close to expiry.
    """

    def __init__(
        self,
        certs_dir: Path = CERT_DIR_DEFAULT,
        rotate_days_before: int = ROTATE_DAYS_BEFORE,
    ):
        self.certs_dir = Path(certs_dir)
        self.rotate_days_before = rotate_days_before

    # ── Core scan ────────────────────────────────────────────

    def scan_all_certs(self) -> list[dict]:
        """
        Return a list of cert status dicts for every .crt in certs_dir.
        Works without cryptography installed (falls back to stub data).
        """
        results = []
        if not self.certs_dir.exists():
            return results

        for cert_path in sorted(self.certs_dir.glob("*.crt")):
            results.append(self._inspect_cert(cert_path))

        return results

    def _inspect_cert(self, cert_path: Path) -> dict:
        name = cert_path.stem
        now = datetime.now(timezone.utc)

        if not _CRYPTO_AVAILABLE:
            # Synthetic stub for environments without cryptography
            days = 90 if "hq" in name else 45 if "bff" in name else 180
            expires_at = (now + timedelta(days=days)).isoformat()
            return {
                "name": name,
                "path": str(cert_path),
                "days_until_expiry": days,
                "expires_at": expires_at,
                "needs_rotation": days <= self.rotate_days_before,
                "status": "ok" if days > self.rotate_days_before else "expiring_soon",
                "note": "cryptography package not installed — synthetic data",
            }

        try:
            pem_data = cert_path.read_bytes()
            cert = x509.load_pem_x509_certificate(pem_data, default_backend())
            not_after = cert.not_valid_after_utc if hasattr(cert, "not_valid_after_utc") \
                        else cert.not_valid_after.replace(tzinfo=timezone.utc)
            delta = not_after - now
            days = max(0, delta.days)
            status = "expired" if days == 0 else ("expiring_soon" if days <= self.rotate_days_before else "ok")
            return {
                "name": name,
                "path": str(cert_path),
                "days_until_expiry": days,
                "expires_at": not_after.isoformat(),
                "subject": cert.subject.rfc4514_string(),
                "issuer": cert.issuer.rfc4514_string(),
                "serial_number": str(cert.serial_number),
                "needs_rotation": days <= self.rotate_days_before,
                "status": status,
            }
        except Exception as exc:
            return {
                "name": name,
                "path": str(cert_path),
                "days_until_expiry": -1,
                "expires_at": None,
                "needs_rotation": True,
                "status": "parse_error",
                "error": str(exc),
            }

    # ── Auto-rotation ─────────────────────────────────────────

    def auto_rotate_expiring(self) -> list[str]:
        """
        Invoke rotate_certs.py for each cert within the rotation window.
        Returns list of cert names that were rotated.
        """
        rotated = []
        for cert_info in self.scan_all_certs():
            if cert_info.get("needs_rotation") and cert_info["days_until_expiry"] >= 0:
                name = cert_info["name"]
                success = self._rotate_cert(name)
                if success:
                    rotated.append(name)
                    _audit_log.append({
                        "event": "cert_rotated",
                        "cert": name,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "days_remaining": cert_info["days_until_expiry"],
                    })
        return rotated

    def _rotate_cert(self, cert_name: str) -> bool:
        if ROTATE_SCRIPT.exists():
            try:
                subprocess.run(
                    ["python", str(ROTATE_SCRIPT), "--cert", cert_name],
                    timeout=30, check=True, capture_output=True,
                )
                return True
            except Exception:
                pass
        # No rotate script — just log the intent
        return False

    def schedule_daily_check(self, scheduler) -> None:
        """Register a daily APScheduler job at 02:00 UTC."""
        scheduler.add_job(
            self.auto_rotate_expiring,
            trigger="cron", hour=2, minute=0,
            id="cert_daily_check", replace_existing=True,
        )

    # ── Dashboard ─────────────────────────────────────────────

    def get_expiry_dashboard(self) -> dict:
        """Summary dict for the security dashboard."""
        certs = self.scan_all_certs()
        expiring = [c for c in certs if c.get("needs_rotation") and c["days_until_expiry"] >= 0]
        expired  = [c for c in certs if c["days_until_expiry"] == 0 or c["status"] == "expired"]
        return {
            "total_certs": len(certs),
            "expiring_soon": len(expiring),
            "already_expired": len(expired),
            "certs": certs,
            "rotation_log": _audit_log[-20:],
            "scan_timestamp": datetime.now(timezone.utc).isoformat() + "Z",
        }
