"""
security/honeypot.py

Honeypot endpoint registration for FastAPI.
Logs every hit to an in-memory log and triggers an audit chain entry.
Returns convincing fake responses to confuse and track attackers.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


HONEYPOT_ROUTES: list[str] = [
    "/api/admin_backup",
    "/api/debug",
    "/phpmyadmin",
    "/wp-admin",
    "/.env",
    "/api/admin/reset",
    "/api/v1/internal/users",
    "/admin",
    "/api/config",
    "/api/keys",
]

FAKE_RESPONSES: dict[str, Any] = {
    "/api/admin_backup": {
        "status": "ok",
        "backup_id": "bkp_20240101_0200",
        "size_mb": 847,
        "location": "/var/backup/securescore/",
        "encrypted": True,
    },
    "/api/debug": {
        "debug_mode": False,
        "version": "2.1.0",
        "env": "production",
        "db_host": "localhost",
        "uptime_seconds": 86400,
    },
    "/phpmyadmin": {"status": "redirect", "location": "/phpmyadmin/index.php"},
    "/wp-admin": {"status": "WordPress not installed", "cms": None},
    "/.env": "DB_HOST=localhost\nDB_USER=root\nDB_PASS=changeme\nJWT_SECRET=supersecret",
    "/api/admin/reset": {"status": "reset_initiated", "target": "all_users", "dry_run": True},
    "/api/v1/internal/users": {"users": [], "total": 0, "admin_count": 1},
    "/admin": {"status": "admin panel", "version": "1.0"},
    "/api/config": {"config_version": "3.2", "env": "production"},
    "/api/keys": {"api_key": "sk-REDACTED", "created_at": "2024-01-01T00:00:00Z"},
}

_honeypot_log: list[dict] = []


def log_honeypot_hit(endpoint: str, request: Request, audit=None) -> None:
    """Record a honeypot hit with request metadata."""
    entry = {
        "endpoint":   endpoint,
        "ip":         request.client.host if request.client else "unknown",
        "user_agent": request.headers.get("user-agent", ""),
        "method":     request.method,
        "timestamp":  datetime.now(timezone.utc).isoformat() + "Z",
        "headers":    dict(request.headers),
    }
    _honeypot_log.append(entry)

    if audit is not None:
        try:
            audit.append({
                "event": "honeypot_hit",
                "endpoint": endpoint,
                "ip": entry["ip"],
                "timestamp": entry["timestamp"],
            })
        except Exception:
            pass


def register_honeypot_routes(app: FastAPI, audit=None) -> None:
    """
    Dynamically register all honeypot routes on the FastAPI app.
    Each route logs the hit and returns a convincing fake response.
    """
    for route in HONEYPOT_ROUTES:
        _register_route(app, route, audit)


def _register_route(app: FastAPI, route: str, audit) -> None:
    fake = FAKE_RESPONSES.get(route, {"status": "ok"})

    # Use closure to capture route and fake per iteration
    async def handler(request: Request, _route=route, _fake=fake):
        log_honeypot_hit(_route, request, audit)
        if isinstance(_fake, str):
            from fastapi.responses import PlainTextResponse
            return PlainTextResponse(_fake, status_code=200)
        return JSONResponse(_fake, status_code=200)

    # Register for GET, POST, PUT, DELETE
    for method in ("GET", "POST", "PUT", "DELETE"):
        app.add_api_route(route, handler, methods=[method], include_in_schema=False)


def get_honeypot_log(last_n: int = 100) -> list[dict]:
    """Return the most recent honeypot hits."""
    return _honeypot_log[-last_n:]


def get_honeypot_stats() -> dict:
    """Summary statistics about honeypot hits."""
    from collections import Counter
    endpoints = Counter(h["endpoint"] for h in _honeypot_log)
    ips = Counter(h["ip"] for h in _honeypot_log)
    return {
        "total_hits": len(_honeypot_log),
        "unique_ips": len(ips),
        "top_endpoints": endpoints.most_common(5),
        "top_ips": ips.most_common(5),
    }
