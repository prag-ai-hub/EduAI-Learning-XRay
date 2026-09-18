"""Response headers this service adds beyond Django's SecurityMiddleware."""

from __future__ import annotations

from django.conf import settings

# A JSON API renders nothing and loads nothing. Saying so explicitly means a
# response reflected into a browser context - an error page, a mistyped
# Content-Type - cannot execute anything.
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

# The back office is a real HTML application: it loads its own stylesheets and
# scripts and posts its own forms. The API policy applied to it blocks all
# three - including, silently, the login form itself, because `form-action`
# falls through to `default-src 'none'`. The first version of the admin here
# looked broken for exactly that reason: no styles, and a login button that did
# nothing at all.
#
# Everything is still same-origin only, and `unsafe-inline` is granted to styles
# alone because Django's widgets carry inline `style` attributes. Scripts get no
# such exemption.
ADMIN_CSP = (
    "default-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; "
    "img-src 'self' data:; "
    "font-src 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "object-src 'none'"
)


class ApiSecurityHeadersMiddleware:
    """Lock down anything a browser might do with a response from this service.

    Two policies, chosen by path rather than by guesswork: the back office and
    the static files it loads get `ADMIN_CSP`, everything else gets the API's.
    A new HTML surface would therefore be locked down by default, which is the
    right way round.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def _is_back_office(self, path: str) -> bool:
        if path.startswith(str(settings.STATIC_URL)):
            return True
        return bool(getattr(settings, "ADMIN_ENABLED", False)) and path.startswith(
            f"/{settings.ADMIN_URL}"
        )

    def __call__(self, request):
        response = self.get_response(request)
        back_office = self._is_back_office(request.path)
        response.setdefault("Content-Security-Policy", ADMIN_CSP if back_office else API_CSP)
        # Belt and braces alongside SecurityMiddleware's own header.
        response.setdefault("X-Content-Type-Options", "nosniff")
        # Answers here are per-user and must never land in a shared cache. The
        # admin's pages are per-user too; its static files are not.
        if request.path.startswith("/api/") or (
            back_office and not request.path.startswith(str(settings.STATIC_URL))
        ):
            response.setdefault("Cache-Control", "no-store")
        return response
