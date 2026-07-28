"""
services/audit/main.py
======================
Audit microservice — tamper-evident hash-chain audit log.
Port 5052.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel

try:
    from observability.logging_config import setup_logging
    setup_logging(service_name="audit")
except ImportError:
    logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
AUDIT_LOG_DIR = BASE_DIR / "hq_state" / "audit"
AUDIT_LOG_DIR.mkdir(parents=True, exist_ok=True)

JWT_SECRET = os.getenv("HQ_SECRET_KEY", "")


def _verify_jwt(token: str) -> dict:
    import base64, hmac as _hmac
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed")
    h, p, s = parts
    exp = base64.urlsafe_b64encode(
        _hmac.new(JWT_SECRET.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    if not _hmac.compare_digest(s, exp):
        raise ValueError("Invalid signature")
    padded = p + "=" * (-len(p) % 4)
    claims = json.loads(base64.urlsafe_b64decode(padded))
    if time.time() > claims.get("exp", 0):
        raise ValueError("Token expired")
    return claims


def auth_dep(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Authorization")
    try:
        return _verify_jwt(authorization.split(" ", 1)[1])
    except ValueError as e:
        raise HTTPException(401, str(e))


# ── Audit chain ───────────────────────────────────────────

class AuditChain:
    def __init__(self, path: Path):
        self.path = path / "audit_chain.jsonl"
        self.lock = threading.Lock()
        self._prev_hash = "GENESIS"
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").strip().split("\n"):
                if line.strip():
                    self._prev_hash = json.loads(line).get("hash", "GENESIS")

    def append(self, event_type: str, branch: str, details: dict):
        ts = datetime.now(timezone.utc).isoformat()
        payload_hash = hashlib.sha256(
            json.dumps(details, sort_keys=True, default=str).encode()
        ).hexdigest()
        entry_data = f"{self._prev_hash}|{event_type}|{branch}|{ts}|{payload_hash}"
        entry_hash = hashlib.sha256(entry_data.encode()).hexdigest()
        record = {
            "seq": self._count() + 1,
            "event": event_type,
            "branch": branch,
            "timestamp": ts,
            "payload_hash": payload_hash,
            "prev_hash": self._prev_hash,
            "hash": entry_hash,
            "details_summary": {k: v for k, v in details.items()
                                if k in ("f1", "accuracy", "train_size", "version", "reason", "role")},
        }
        with self.lock:
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(record) + "\n")
            self._prev_hash = entry_hash
        return record

    def _count(self) -> int:
        if not self.path.exists():
            return 0
        return sum(1 for l in self.path.read_text(encoding="utf-8").strip().split("\n") if l.strip())

    def verify_chain(self) -> tuple[bool, int, str]:
        if not self.path.exists():
            return True, 0, "Empty chain"
        prev = "GENESIS"
        count = 0
        for line in self.path.read_text(encoding="utf-8").strip().split("\n"):
            if not line.strip():
                continue
            entry = json.loads(line)
            count += 1
            if entry["prev_hash"] != prev:
                return False, count, f"Chain break at seq {entry['seq']}"
            expected_data = f"{entry['prev_hash']}|{entry['event']}|{entry['branch']}|{entry['timestamp']}|{entry['payload_hash']}"
            if entry["hash"] != hashlib.sha256(expected_data.encode()).hexdigest():
                return False, count, f"Tamper at seq {entry['seq']}"
            prev = entry["hash"]
        return True, count, f"Chain valid ({count} entries)"

    def get_entries(self, last_n: int = 50) -> list[dict]:
        if not self.path.exists():
            return []
        lines = self.path.read_text(encoding="utf-8").strip().split("\n")
        return [json.loads(l) for l in lines[-last_n:] if l.strip()]


audit_chain = AuditChain(AUDIT_LOG_DIR)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Audit service starting")
    yield
    logger.info("Audit service shutting down")


app = FastAPI(
    title="SecureScore — Audit Service",
    version="1.0.0",
    description="Tamper-evident SHA-256 hash-chain audit log.",
    lifespan=lifespan,
)


@app.get("/api/health")
def health():
    _, count, _ = audit_chain.verify_chain()
    return {"status": "ok", "service": "audit", "chain_length": count}


@app.get("/api/audit_log")
def get_audit_log(last_n: int = Query(50, ge=1, le=1000), _claims: dict = Depends(auth_dep)):
    entries = audit_chain.get_entries(last_n)
    valid, count, msg = audit_chain.verify_chain()
    return {"entries": entries, "chain_valid": valid, "chain_length": count, "verification": msg}


@app.get("/api/audit_verify")
def verify_audit():
    valid, count, msg = audit_chain.verify_chain()
    return {"valid": valid, "entries": count, "message": msg}


class AppendRequest(BaseModel):
    event_type: str
    branch: str
    details: dict


@app.post("/api/audit/append")
def append_event(req: AppendRequest, _claims: dict = Depends(auth_dep)):
    """Internal endpoint — called by other services to append audit events."""
    record = audit_chain.append(req.event_type, req.branch, req.details)
    return {"status": "appended", "seq": record["seq"], "hash": record["hash"][:16]}


@app.post("/security/audit_export")
def audit_export(last_n: int = Query(100), _claims: dict = Depends(auth_dep)):
    entries = audit_chain.get_entries(last_n)
    valid, count, msg = audit_chain.verify_chain()
    return {
        "export_timestamp": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
        "chain_valid": valid,
        "chain_length": count,
        "verification": msg,
    }
