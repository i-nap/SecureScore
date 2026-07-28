"""Unit tests for IDS ban/expiry logic (Go BFF IDS is in Go; this tests the Python-side rate tracking)."""
from __future__ import annotations

import time
from collections import defaultdict
from datetime import datetime, timedelta


# ── Minimal Python IDS simulation (mirrors Go BFF idsMiddleware logic) ──────

MAX_REQ = 200        # requests per window
WINDOW_S = 60        # 1-minute window
BAN_S = 300          # 5-minute ban

class SimpleIDS:
    def __init__(self, max_req: int = MAX_REQ, window: int = WINDOW_S, ban_duration: int = BAN_S):
        self.max_req = max_req
        self.window = window
        self.ban_duration = ban_duration
        self._counts: dict[str, list[float]] = defaultdict(list)
        self._bans: dict[str, float] = {}
        self._auth_fails: dict[str, int] = defaultdict(int)

    def _now(self) -> float:
        return time.time()

    def is_banned(self, ip: str) -> bool:
        ban_until = self._bans.get(ip)
        if ban_until is None:
            return False
        if self._now() >= ban_until:
            del self._bans[ip]
            return False
        return True

    def record_request(self, ip: str) -> bool:
        """Returns True if request is allowed, False if banned/rate-limited."""
        if self.is_banned(ip):
            return False
        now = self._now()
        window_start = now - self.window
        self._counts[ip] = [t for t in self._counts[ip] if t > window_start]
        self._counts[ip].append(now)
        if len(self._counts[ip]) > self.max_req:
            self._bans[ip] = now + self.ban_duration
            return False
        return True

    def record_auth_failure(self, ip: str) -> int:
        self._auth_fails[ip] += 1
        return self._auth_fails[ip]

    def get_auth_failures(self, ip: str) -> int:
        return self._auth_fails[ip]


# ── Tests ────────────────────────────────────────────────────────────────────

def test_allows_requests_under_limit():
    ids = SimpleIDS(max_req=5, window=60, ban_duration=300)
    for _ in range(5):
        assert ids.record_request("1.2.3.4") is True


def test_bans_on_threshold_breach():
    ids = SimpleIDS(max_req=3, window=60, ban_duration=300)
    for _ in range(3):
        ids.record_request("1.2.3.4")
    # 4th request triggers ban
    result = ids.record_request("1.2.3.4")
    assert result is False
    assert ids.is_banned("1.2.3.4") is True


def test_banned_ip_rejected_immediately():
    ids = SimpleIDS(max_req=1, window=60, ban_duration=300)
    ids.record_request("5.5.5.5")
    ids.record_request("5.5.5.5")  # triggers ban
    assert ids.is_banned("5.5.5.5") is True
    assert ids.record_request("5.5.5.5") is False


def test_ban_does_not_affect_other_ips():
    ids = SimpleIDS(max_req=1, window=60, ban_duration=300)
    ids.record_request("bad.ip")
    ids.record_request("bad.ip")  # ban
    assert ids.record_request("good.ip") is True


def test_ban_expires():
    ids = SimpleIDS(max_req=1, window=60, ban_duration=1)  # 1-second ban for testing
    ids.record_request("temp.ip")
    ids.record_request("temp.ip")  # triggers ban
    assert ids.is_banned("temp.ip") is True
    # Manually expire the ban
    ids._bans["temp.ip"] = time.time() - 1
    assert ids.is_banned("temp.ip") is False


def test_auth_failure_counter_increments():
    ids = SimpleIDS()
    assert ids.get_auth_failures("10.0.0.1") == 0
    ids.record_auth_failure("10.0.0.1")
    ids.record_auth_failure("10.0.0.1")
    ids.record_auth_failure("10.0.0.1")
    assert ids.get_auth_failures("10.0.0.1") == 3


def test_auth_failure_counter_per_ip():
    ids = SimpleIDS()
    ids.record_auth_failure("10.0.0.1")
    ids.record_auth_failure("10.0.0.1")
    ids.record_auth_failure("10.0.0.2")
    assert ids.get_auth_failures("10.0.0.1") == 2
    assert ids.get_auth_failures("10.0.0.2") == 1


def test_window_resets_after_expiry():
    ids = SimpleIDS(max_req=2, window=1, ban_duration=300)  # 1-second window
    ids.record_request("10.0.0.3")
    ids.record_request("10.0.0.3")
    # Manually expire the window
    ids._counts["10.0.0.3"] = [time.time() - 2]  # push timestamps out of window
    # Should be allowed again
    assert ids.record_request("10.0.0.3") is True
