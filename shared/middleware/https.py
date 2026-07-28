"""
shared/middleware/https.py — HTTPS redirect enforcement for FastAPI.

Redirects all plain HTTP requests to HTTPS. Enable by passing
force_https=True to apply_security_middleware(), which is controlled
by the FORCE_HTTPS environment variable.
"""
from __future__ import annotations

from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response


class HTTPSRedirectMiddleware(BaseHTTPMiddleware):
    """Redirect HTTP → HTTPS. Respects X-Forwarded-Proto from trusted proxies."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Check both the direct scheme and the forwarded scheme (Nginx/load balancer)
        scheme = request.headers.get("X-Forwarded-Proto", request.url.scheme)
        if scheme == "http":
            https_url = str(request.url).replace("http://", "https://", 1)
            return RedirectResponse(url=https_url, status_code=301)
        return await call_next(request)
