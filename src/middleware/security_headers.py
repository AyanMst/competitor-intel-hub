"""Security response headers.

Applied to every response — including error responses, since
`BaseHTTPMiddleware` wraps the whole ASGI call — so these are never
accidentally skipped by an endpoint that raises before reaching a
per-route header dependency.

Only sets headers that were missing entirely; does not touch CORS (already
handled by `CORSMiddleware` in api.py) or any header an endpoint sets
itself.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

# Deliberately conservative: this backend serves JSON, not HTML, to the
# frontend, so `default-src 'self'` mainly protects the auto-generated
# /docs, /redoc, and error pages (Starlette/FastAPI's own HTML) from
# executing injected script. Swagger UI's CDN-hosted JS/CSS at /docs will
# be blocked by this policy — expected/acceptable for an API-only backend;
# relax with an explicit `script-src`/`style-src` allowance for the CDN
# host if /docs needs to keep working in a given environment.
_CSP = "default-src 'self'; frame-ancestors 'none'"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
        )
        response.headers.setdefault("Content-Security-Policy", _CSP)
        return response
