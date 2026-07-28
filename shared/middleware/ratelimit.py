"""
shared/middleware/ratelimit.py — Per-IP rate limiting middleware for FastAPI.

Uses an in-process sliding-window counter backed by a dict. For multi-process
or multi-replica deployments, replace _store with a Redis-backed implementation
(the interface is identical — just swap the backend).

Default limits (overridden via environment variables):
  RATE_LIMIT_GLOBAL_PER_MIN   — applied to every request (default 300)
  RATE_LIMIT_AUTH_PER_MIN     — applied to /auth/* and /login* paths (default 10)
  RATE_LIMIT_LOGIN_PER_MIN    — applied to exact login endpoint (default 5)
"""
from __future__ import annotations

import json
import os
import time
from collections import defaultdict
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

_GLOBAL_LIMIT: int = int(os.getenv("RATE_LIMIT_GLOBAL_PER_MIN", "300"))
_AUTH_LIMIT:   int = int(os.getenv("RATE_LIMIT_AUTH_PER_MIN",   "10"))
_LOGIN_LIMIT:  int = int(os.getenv("RATE_LIMIT_LOGIN_PER_MIN",  "5"))

_AUTH_PATHS  = {"/auth/login", "/auth/refresh", "/auth/register", "/login", "/token"}
_LOGIN_PATHS = {"/auth/login", "/login", "/token"}


class _SlidingWindowCounter:
    """Thread-unsafe sliding window. Adequate for single-process FastAPI with asyncio."""

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str, limit: int, window_seconds: float = 60.0) -> bool:
        now = time.monotonic()
        cutoff = now - window_seconds
        hits = self._hits[key]
        # Evict old entries
        while hits and hits[0] < cutoff:
            hits.pop(0)
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True


_store = _SlidingWindowCounter()


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        forwarded_for = request.headers.get("X-Forwarded-For")
        ip = forwarded_for.split(",")[0].strip() if forwarded_for else (
            request.client.host if request.client else "unknown"
        )
        path = request.url.path.rstrip("/")

        # Most restrictive limit wins — check from strictest to most permissive
        if path in _LOGIN_PATHS:
            if not _store.is_allowed(f"login:{ip}", _LOGIN_LIMIT):
                return _rate_limited_response("login_rate_limit_exceeded", 60)

        if path in _AUTH_PATHS:
            if not _store.is_allowed(f"auth:{ip}", _AUTH_LIMIT):
                return _rate_limited_response("auth_rate_limit_exceeded", 60)

        if not _store.is_allowed(f"global:{ip}", _GLOBAL_LIMIT):
            return _rate_limited_response("rate_limit_exceeded", 60)

        return await call_next(request)


def _rate_limited_response(code: str, retry_after: int) -> Response:
    body = json.dumps({"error": code, "detail": "Too many requests. Please slow down."})
    return Response(
        content=body,
        status_code=429,
        headers={
            "Content-Type": "application/json",
            "Retry-After": str(retry_after),
        },
    )
