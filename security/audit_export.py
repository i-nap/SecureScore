"""
security/audit_export.py

AES-256-GCM encrypted export of the HQ audit log chain.
Key is read from AUDIT_EXPORT_KEY env var (base64-encoded 32 bytes).
"""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    _CRYPTO_AVAILABLE = True
except ImportError:
    _CRYPTO_AVAILABLE = False

AUDIT_CHAIN_DEFAULT = Path("hq_state/audit_chain.jsonl")
EXPORT_DIR          = Path("hq_state/audit")
ENV_KEY_VAR         = "AUDIT_EXPORT_KEY"

# Fallback test key (32 zero bytes) — never use in production
_TEST_KEY = bytes(32)


def _get_key() -> bytes:
    """Load AES-256 key from environment variable (base64-encoded)."""
    raw = os.environ.get(ENV_KEY_VAR, "")
    if raw:
        try:
            key = base64.b64decode(raw)
            if len(key) == 32:
                return key
        except Exception:
            pass
    return _TEST_KEY


def export_audit_log_encrypted(
    audit_log_path: Path = AUDIT_CHAIN_DEFAULT,
    output_path: Optional[Path] = None,
) -> dict:
    """
    Read the JSONL audit chain, AES-256-GCM encrypt it, and write to disk.
    Returns metadata including nonce and entry count.
    """
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    if output_path is None:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        output_path = EXPORT_DIR / f"audit_export_{ts}.enc"

    # Read entries
    entries: list[dict] = []
    if Path(audit_log_path).exists():
        for line in Path(audit_log_path).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    plaintext = json.dumps(entries, ensure_ascii=False).encode("utf-8")
    timestamp = datetime.now(timezone.utc).isoformat() + "Z"

    if not _CRYPTO_AVAILABLE:
        # Write base64-encoded plaintext as fallback (clearly marked)
        nonce_b64 = base64.b64encode(b"nocrypto_nonce").decode()
        ciphertext = base64.b64encode(plaintext)
        output_path.write_bytes(b"NOCRYPTO:" + ciphertext)
        return {
            "output_path": str(output_path),
            "size_bytes": len(ciphertext),
            "entries_count": len(entries),
            "nonce_b64": nonce_b64,
            "timestamp": timestamp,
            "encrypted": False,
            "warning": "cryptography package not installed — file is base64 only",
        }

    key = _get_key()
    nonce = os.urandom(12)   # 96-bit nonce for GCM
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)

    # File format: 12-byte nonce || ciphertext+tag
    output_path.write_bytes(nonce + ciphertext)
    nonce_b64 = base64.b64encode(nonce).decode()

    return {
        "output_path": str(output_path),
        "size_bytes": len(nonce) + len(ciphertext),
        "entries_count": len(entries),
        "nonce_b64": nonce_b64,
        "timestamp": timestamp,
        "encrypted": True,
    }


def decrypt_audit_log(encrypted_path: Path, key_b64: Optional[str] = None) -> list[dict]:
    """
    Decrypt an exported audit log.
    key_b64: base64-encoded 32-byte key (uses env var if omitted).
    """
    data = Path(encrypted_path).read_bytes()

    # Handle unencrypted fallback
    if data.startswith(b"NOCRYPTO:"):
        plaintext = base64.b64decode(data[len(b"NOCRYPTO:"):])
        return json.loads(plaintext.decode("utf-8"))

    if not _CRYPTO_AVAILABLE:
        raise RuntimeError("cryptography package not installed")

    if key_b64:
        key = base64.b64decode(key_b64)
    else:
        key = _get_key()

    nonce = data[:12]
    ciphertext = data[12:]
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return json.loads(plaintext.decode("utf-8"))
