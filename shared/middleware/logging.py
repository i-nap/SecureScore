"""
shared/middleware/logging.py — Structured request logging for FastAPI.

Logs every request as a JSON line with: request_id, method, path,
status_code, duration_ms, ip, user_agent, timestamp.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("securescore.access")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        start = time.perf_counter()

        response = await call_next(request)

        duration_ms = round((time.perf_counter() - start) * 1000, 2)

        # Resolve real client IP — trust X-Forwarded-For only behind a known proxy
        forwarded_for = request.headers.get("X-Forwarded-For")
        ip = forwarded_for.split(",")[0].strip() if forwarded_for else (
            request.client.host if request.client else "unknown"
        )

        record = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "query": str(request.url.query) or None,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
            "ip": ip,
            "user_agent": request.headers.get("user-agent"),
        }
        logger.info(json.dumps(record))

        response.headers["X-Request-ID"] = request_id
        return response
