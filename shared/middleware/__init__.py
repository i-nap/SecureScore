"""
shared/middleware — Phase 1 FastAPI security hardening middleware.

Usage in any FastAPI app:

    from shared.middleware import apply_security_middleware
    app = FastAPI(...)
    apply_security_middleware(app)
"""
from shared.middleware.logging import RequestLoggingMiddleware
from shared.middleware.ratelimit import RateLimitMiddleware
from shared.middleware.https import HTTPSRedirectMiddleware

__all__ = [
    "RequestLoggingMiddleware",
    "RateLimitMiddleware",
    "HTTPSRedirectMiddleware",
    "apply_security_middleware",
]


def apply_security_middleware(app, *, force_https: bool = False) -> None:
    """
    Attach all Phase 1 security middleware to a FastAPI application.
    Call this once at app construction, before adding routes.

    Order matters: middleware is applied innermost-first, so the last
    add_middleware call wraps all others.
    """
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(RateLimitMiddleware)
    if force_https:
        app.add_middleware(HTTPSRedirectMiddleware)
