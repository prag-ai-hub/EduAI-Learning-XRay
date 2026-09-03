"""Automated tests. Fast, hermetic, and never pointed at a shared database.

The suite must run on a fresh clone with no backend/.env, so this module
supplies its own throwaway configuration BEFORE importing `base` - pytest-django
loads settings earlier than any conftest, so a conftest cannot do this. Real
environment values still win: these are `setdefault` calls.
"""

import os

os.environ.setdefault("DJANGO_SECRET_KEY", "test-secret-key-not-used-outside-tests")
os.environ.setdefault("DJANGO_DEBUG", "False")
os.environ.setdefault("DJANGO_ALLOWED_HOSTS", "testserver,localhost")
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
os.environ.setdefault("SUPABASE_URL", "http://127.0.0.1:54321")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-at-least-32-characters-long")
os.environ.setdefault("SUPABASE_JWT_AUDIENCE", "authenticated")
os.environ.setdefault("CORS_ALLOWED_ORIGINS", "http://localhost:3000")

from .base import *  # noqa: E402,F401,F403

DEBUG = False

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

# Rate limits make assertions non-deterministic; the throttle rules
# themselves are tested explicitly in apps/common/tests.
REST_FRAMEWORK = {  # noqa: F405
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {},
}
