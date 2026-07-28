"""
security/ids.py

Intrusion Detection System — rate-limiting, failed-auth tracking, and IP banning.
Module-level singleton `ids` is imported by bff_gateway.py middleware.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Optional

BAN_DURATION_SEC       = 300    # 5-minute ban
MAX_FAILED_AUTH_PER_MIN = 5     # bans after 5 failed logins in 60 s
MAX_BURST_REQ_PER_SEC  = 20     # bans after 20 requests in 1 s


class IntrusionDetectionSystem:
    """
    Tracks failed authentication attempts and request bursts per IP.
    Auto-unbans IPs after BAN_DURATION_SEC seconds.
    """

    def __init__(
        self,
        ban_duration: int = BAN_DURATION_SEC,
        max_failed_auth: int = MAX_FAILED_AUTH_PER_MIN,
        max_burst: int = MAX_BURST_REQ_PER_SEC,
    ):
        self.ban_duration   = ban_duration
        self.max_failed_auth = max_failed_auth
        self.max_burst      = max_burst

        self._failed_auth: dict[str, list[float]] = defaultdict(list)
        self._request_counts: dict[str, deque]    = defaultdict(lambda: deque(maxlen=200))
        self._banned_ips: dict[str, float]        = {}   # ip → unban_timestamp
        self._ids_log: list[dict]                 = []

    # ── Authentication failure tracking ───────────────────────

    def record_failed_auth(self, ip: str, username: str = "") -> bool:
        """
        Record a failed auth attempt. Returns True if the IP should be banned.
        Tracks timestamps; purges entries older than 60 seconds.
        """
        now = time.time()
        self._failed_auth[ip] = [t for t in self._failed_auth[ip] if now - t < 60]
        self._failed_auth[ip].append(now)

        if len(self._failed_auth[ip]) >= self.max_failed_auth:
            self.ban_ip(ip, reason=f"too_many_failed_auth (username={username})")
            return True
        return False

    # ── Burst detection ───────────────────────────────────────

    def record_request(self, ip: str) -> bool:
        """
        Record a request. Returns True if this IP should be banned for bursting.
        """
        now = time.time()
        dq = self._request_counts[ip]
        dq.append(now)

        # Count requests in last 1 second
        burst_count = sum(1 for t in dq if now - t < 1.0)
        if burst_count >= self.max_burst:
            self.ban_ip(ip, reason=f"request_burst ({burst_count} req/s)")
            return True
        return False

    # ── Ban management ────────────────────────────────────────

    def ban_ip(self, ip: str, reason: str = "manual") -> None:
        """Ban an IP for ban_duration seconds."""
        if ip in self._banned_ips:
            return  # already banned
        unban_at = time.time() + self.ban_duration
        self._banned_ips[ip] = unban_at
        entry = {
            "event":    "ip_banned",
            "ip":       ip,
            "reason":   reason,
            "banned_at": datetime.now(timezone.utc).isoformat() + "Z",
            "unban_at": datetime.fromtimestamp(unban_at, tz=timezone.utc).isoformat() + "Z",
        }
        self._ids_log.append(entry)

    def unban_ip(self, ip: str) -> bool:
        """Manually unban an IP. Returns True if it was banned."""
        if ip in self._banned_ips:
            del self._banned_ips[ip]
            self._ids_log.append({
                "event":      "ip_unbanned_manual",
                "ip":         ip,
                "timestamp":  datetime.now(timezone.utc).isoformat() + "Z",
            })
            return True
        return False

    def is_banned(self, ip: str) -> bool:
        """Check if an IP is currently banned; auto-unban expired bans."""
        unban_at = self._banned_ips.get(ip)
        if unban_at is None:
            return False
        if time.time() >= unban_at:
            del self._banned_ips[ip]
            return False
        return True

    # ── Reporting ─────────────────────────────────────────────

    def get_active_bans(self) -> list[dict]:
        """Return currently active bans with seconds remaining."""
        now = time.time()
        active = []
        for ip, unban_at in list(self._banned_ips.items()):
            remaining = unban_at - now
            if remaining > 0:
                active.append({
                    "ip": ip,
                    "seconds_remaining": round(remaining),
                    "unban_at": datetime.fromtimestamp(unban_at, tz=timezone.utc).isoformat() + "Z",
                })
            else:
                del self._banned_ips[ip]
        return active

    def get_ids_log(self, last_n: int = 100) -> list[dict]:
        """Return the last N IDS events."""
        return self._ids_log[-last_n:]

    def get_stats(self) -> dict:
        """Summary statistics."""
        return {
            "active_bans":      len(self.get_active_bans()),
            "total_events":     len(self._ids_log),
            "tracked_ips":      len(self._failed_auth),
            "ban_duration_sec": self.ban_duration,
        }


# Module-level singleton — imported by bff_gateway.py
ids = IntrusionDetectionSystem()
