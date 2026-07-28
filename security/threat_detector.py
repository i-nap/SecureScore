"""
security/threat_detector.py
============================
Behavioural threat detection + session revocation.

Monitors per-user actions after they are already authenticated and assigns
a rolling threat score (0–100).  When the score crosses a threshold the
user's session is automatically revoked and their account suspended.

Threat signals tracked
──────────────────────
• Request burst          – >30 requests in 60 s from the same user
• Cross-user snooping    – customer/branch user hitting other users' endpoints
• Bulk data harvest      – repeated "export / list-all" endpoints in short window
• Privilege probe        – repeated 403/401 responses (endpoint probing)
• Off-hours anomaly      – requests between 00:00–04:00 local time (soft signal)
• Repeated suspicious    – score keeps climbing without cooldown

Auto-revocation threshold: score >= 80
"""

from __future__ import annotations

import time
import threading
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Dict, List, Optional

# ── Tuning constants ──────────────────────────────────────────────────────────
REVOKE_THRESHOLD      = 80    # auto-suspend above this
SCORE_DECAY_PER_MIN   = 5     # score drops when user is quiet
BURST_WINDOW_SEC      = 60
BURST_MAX_REQUESTS    = 30
HARVEST_WINDOW_SEC    = 120
HARVEST_MAX_CALLS     = 15    # bulk-list endpoint calls in 2 min
PROBE_WINDOW_SEC      = 60
PROBE_MAX_ERRORS      = 8     # 403/401 hits before flagging

BULK_ENDPOINTS = {
    "/api/branch/customers",
    "/api/hq/records",
    "/api/branch/records",
    "/api/hq/audit",
    "/api/branch/fraud_alerts",
}

SENSITIVE_PREFIXES = {
    "/api/branch/customer/",   # should only access own customer
    "/api/customer/",
}


class _UserState:
    __slots__ = (
        "score", "last_seen", "last_score_update",
        "request_times", "bulk_call_times", "error_times",
        "events",
    )

    def __init__(self) -> None:
        self.score: float = 0.0
        self.last_seen: float = time.time()
        self.last_score_update: float = time.time()
        self.request_times: deque = deque(maxlen=500)
        self.bulk_call_times: deque = deque(maxlen=100)
        self.error_times: deque = deque(maxlen=100)
        self.events: List[dict] = []   # last 50 threat events


class ThreatDetector:
    """
    Thread-safe behavioural threat detector.
    Call record_request() on every authenticated API call.
    """

    def __init__(self) -> None:
        self._users: Dict[str, _UserState] = {}
        self._suspended: Dict[str, dict] = {}   # user_id → suspension info
        self._revoked_tokens: Dict[str, float] = {}  # jti → revoke_timestamp
        self._lock = threading.Lock()
        self._threat_log: List[dict] = []        # global event log

    # ── Main entry point ──────────────────────────────────────────────

    def record_request(
        self,
        user_id: str,
        role: str,
        endpoint: str,
        method: str = "GET",
        status_code: int = 200,
        branch_id: Optional[str] = None,
    ) -> dict:
        """
        Record one request from an authenticated user.
        Returns: {'threat_score': float, 'action': 'allow'|'revoke', 'reason': str}
        """
        with self._lock:
            state = self._users.setdefault(user_id, _UserState())
            now = time.time()
            state.last_seen = now

            # Decay old score
            minutes_idle = (now - state.last_score_update) / 60.0
            state.score = max(0.0, state.score - minutes_idle * SCORE_DECAY_PER_MIN)
            state.last_score_update = now

            state.request_times.append(now)

            reason = ""
            delta = 0.0

            # ── Signal 1: Request burst ───────────────────────────────
            burst = sum(1 for t in state.request_times if now - t < BURST_WINDOW_SEC)
            if burst > BURST_MAX_REQUESTS:
                delta += 15
                reason = f"request_burst ({burst} req/60s)"

            # ── Signal 2: Bulk data harvest ───────────────────────────
            if any(endpoint.startswith(ep) for ep in BULK_ENDPOINTS):
                state.bulk_call_times.append(now)
            harvest = sum(1 for t in state.bulk_call_times if now - t < HARVEST_WINDOW_SEC)
            if harvest > HARVEST_MAX_CALLS:
                delta += 20
                reason = reason or f"bulk_data_harvest ({harvest} calls/2min)"

            # ── Signal 3: Privilege probe (repeated 4xx) ──────────────
            if status_code in (401, 403, 404):
                state.error_times.append(now)
            probes = sum(1 for t in state.error_times if now - t < PROBE_WINDOW_SEC)
            if probes > PROBE_MAX_ERRORS:
                delta += 25
                reason = reason or f"privilege_probe ({probes} 4xx/60s)"

            # ── Signal 4: Cross-user snooping ─────────────────────────
            if role == "customer" and branch_id:
                for pfx in SENSITIVE_PREFIXES:
                    if endpoint.startswith(pfx) and branch_id not in endpoint:
                        delta += 30
                        reason = reason or f"cross_user_access ({endpoint})"
                        break

            if role == "branch_manager" and branch_id:
                # Branch manager shouldn't hit /hq/ write endpoints
                if endpoint.startswith("/api/hq/") and method in ("POST", "PUT", "DELETE", "PATCH"):
                    delta += 20
                    reason = reason or f"hq_write_from_branch ({endpoint})"

            # ── Signal 5: Off-hours access (soft) ────────────────────
            hour = datetime.now().hour
            if 0 <= hour < 4:
                delta += 5
                reason = reason or "off_hours_access"

            # Apply delta
            if delta > 0:
                state.score = min(100.0, state.score + delta)
                event = {
                    "user_id":   user_id,
                    "role":      role,
                    "endpoint":  endpoint,
                    "method":    method,
                    "status":    status_code,
                    "delta":     round(delta, 1),
                    "score":     round(state.score, 1),
                    "reason":    reason,
                    "timestamp": datetime.now(timezone.utc).isoformat() + "Z",
                }
                state.events.append(event)
                if len(state.events) > 50:
                    state.events.pop(0)
                self._threat_log.append(event)
                if len(self._threat_log) > 1000:
                    self._threat_log.pop(0)

            # ── Auto-revocation ───────────────────────────────────────
            if state.score >= REVOKE_THRESHOLD and user_id not in self._suspended:
                self._do_suspend(user_id, role, reason=f"auto_threat_score_{round(state.score)}")
                return {
                    "threat_score": round(state.score, 1),
                    "action": "revoke",
                    "reason": f"Suspended: {reason}",
                }

            return {
                "threat_score": round(state.score, 1),
                "action": "allow",
                "reason": reason or "ok",
            }

    # ── Manual admin actions ──────────────────────────────────────────

    def suspend_user(self, user_id: str, reason: str = "manual_admin_action") -> None:
        """HQ Admin manually suspends a user — all future requests blocked."""
        with self._lock:
            self._do_suspend(user_id, role="unknown", reason=reason)

    def unsuspend_user(self, user_id: str) -> bool:
        """Re-enable a suspended user. Returns True if they were suspended."""
        with self._lock:
            if user_id in self._suspended:
                del self._suspended[user_id]
                if user_id in self._users:
                    self._users[user_id].score = 0.0
                self._threat_log.append({
                    "user_id":   user_id,
                    "reason":    "unsuspended_by_admin",
                    "timestamp": datetime.now(timezone.utc).isoformat() + "Z",
                })
                return True
            return False

    def revoke_token(self, jti: str) -> None:
        """Revoke a single JWT by its jti claim (single-session kill)."""
        with self._lock:
            self._revoked_tokens[jti] = time.time()

    def is_suspended(self, user_id: str) -> bool:
        with self._lock:
            return user_id in self._suspended

    def is_token_revoked(self, jti: str) -> bool:
        with self._lock:
            return jti in self._revoked_tokens

    # ── Reporting ─────────────────────────────────────────────────────

    def get_user_threat(self, user_id: str) -> dict:
        with self._lock:
            state = self._users.get(user_id)
            if not state:
                return {"user_id": user_id, "threat_score": 0, "suspended": False, "events": []}
            return {
                "user_id":     user_id,
                "threat_score": round(state.score, 1),
                "suspended":   user_id in self._suspended,
                "last_seen":   datetime.fromtimestamp(state.last_seen, tz=timezone.utc).isoformat() + "Z",
                "events":      list(state.events[-10:]),
            }

    def get_all_threats(self) -> list[dict]:
        """Return threat state for all tracked users, sorted by score desc."""
        with self._lock:
            result = []
            for uid, state in self._users.items():
                result.append({
                    "user_id":     uid,
                    "threat_score": round(state.score, 1),
                    "suspended":   uid in self._suspended,
                    "last_seen":   datetime.fromtimestamp(state.last_seen, tz=timezone.utc).isoformat() + "Z",
                    "event_count": len(state.events),
                })
            return sorted(result, key=lambda x: x["threat_score"], reverse=True)

    def get_suspended_users(self) -> list[dict]:
        with self._lock:
            return list(self._suspended.values())

    def get_threat_log(self, last_n: int = 100) -> list[dict]:
        with self._lock:
            return self._threat_log[-last_n:]

    def get_stats(self) -> dict:
        with self._lock:
            high_risk = sum(1 for s in self._users.values() if s.score >= 50)
            return {
                "tracked_users":   len(self._users),
                "suspended_users": len(self._suspended),
                "high_risk_users": high_risk,
                "total_events":    len(self._threat_log),
                "revoked_tokens":  len(self._revoked_tokens),
                "auto_threshold":  REVOKE_THRESHOLD,
            }

    # ── Internal ──────────────────────────────────────────────────────

    def _do_suspend(self, user_id: str, role: str, reason: str) -> None:
        info = {
            "user_id":     user_id,
            "role":        role,
            "reason":      reason,
            "suspended_at": datetime.now(timezone.utc).isoformat() + "Z",
        }
        self._suspended[user_id] = info
        self._threat_log.append({**info, "event": "user_suspended"})


# Module-level singleton — imported by bff_gateway.py
threat_detector = ThreatDetector()
