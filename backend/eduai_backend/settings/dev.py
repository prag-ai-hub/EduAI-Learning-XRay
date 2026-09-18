"""Local development. Never used to serve real traffic."""

from .base import *  # noqa: F401,F403
from .base import env

DEBUG = True

# Override via ALLOWED_HOSTS when running in a container or a tunnel.
ALLOWED_HOSTS = env("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# The Expo web dev server (`make dev-web`, :8081) - the client every screen is
# moving to - and the retiring Next.js one (:3000) until it is deleted. Without
# :8081 the browser refuses every Django response to the Expo app in
# development, which surfaces as a network error rather than as CORS.
CORS_ALLOWED_ORIGINS = env(
    "CORS_ALLOWED_ORIGINS",
    default=[
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
)

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Browsable API is a convenience while developing; it is off in prod.
REST_FRAMEWORK = {  # noqa: F405
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
}
