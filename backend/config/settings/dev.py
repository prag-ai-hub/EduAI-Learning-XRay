"""Local development. Never used to serve real traffic."""

from .base import *  # noqa: F401,F403
from .base import env

DEBUG = True

# Override via DJANGO_ALLOWED_HOSTS when running in a container.
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# The Next.js dev server.
CORS_ALLOWED_ORIGINS = env(
    "CORS_ALLOWED_ORIGINS",
    default=["http://localhost:3000", "http://127.0.0.1:3000"],
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
