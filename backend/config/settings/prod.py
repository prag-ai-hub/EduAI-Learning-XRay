"""Production. Runs on a dedicated Python host - NOT Cloudflare Workers."""

from .base import *  # noqa: F401,F403
from .base import env

DEBUG = False

ALLOWED_HOSTS = env("ALLOWED_HOSTS")  # explicit, no wildcard fallback

# --- Transport security ---------------------------------------------------
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31_536_000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# --- Response hardening ---------------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# --- Cookies --------------------------------------------------------------
# The API is token-authenticated and stateless, but anything Django does set
# must still be locked down.
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# JSON only - no browsable API on a production surface.
REST_FRAMEWORK = {  # noqa: F405
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
}

# --- Cache -----------------------------------------------------------------
# Throttle counters live in the cache. Django's default LocMemCache is
# per-process, so under gunicorn with N workers every rate limit is silently
# N times looser than it reads. Point REDIS_URL at a shared cache in
# production; without one the limits are advisory at best.
_redis_url = env("REDIS_URL", default="")
CACHES = {
    "default": (
        {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": _redis_url}
        if _redis_url
        else {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}
    )
}

# Django's setting names are fixed; the environment names follow the house
# MAIL_* convention so one operator reads the same keys across services.
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = env("MAIL_SERVER", default="")
EMAIL_PORT = env.int("MAIL_PORT", default=587)
EMAIL_HOST_USER = env("MAIL_USERNAME", default="")
EMAIL_HOST_PASSWORD = env("MAIL_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("MAIL_USE_TLS", default=True)
DEFAULT_FROM_EMAIL = env("MAIL_DEFAULT_SENDER", default="no-reply@eduaihub.in")
