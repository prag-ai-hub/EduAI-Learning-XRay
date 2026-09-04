"""Response headers this service adds beyond Django's SecurityMiddleware."""

from __future__ import annotations

# A JSON API renders nothing and loads nothing. Saying so explicitly means a
# response reflected into a browser context - an error page, a mistyped
# Content-Type - cannot execute anything.
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"


class ApiSecurityHeadersMiddleware:
    """Lock down anything a browser might do with an API response."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault("Content-Security-Policy", API_CSP)
        # Belt and braces alongside SecurityMiddleware's own header.
        response.setdefault("X-Content-Type-Options", "nosniff")
        # Answers here are per-user and must never land in a shared cache.
        if request.path.startswith("/api/"):
            response.setdefault("Cache-Control", "no-store")
        return response
