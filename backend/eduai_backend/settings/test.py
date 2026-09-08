"""Automated tests. Fast, hermetic, and never pointed at a shared database.

The suite must run on a fresh clone with no backend/.env, so this module
supplies its own throwaway configuration BEFORE importing `base` - pytest-django
loads settings earlier than any conftest, so a conftest cannot do this. Real
environment values still win: these are `setdefault` calls.
"""

import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-outside-tests")
os.environ.setdefault("DEBUG", "False")
os.environ.setdefault("ALLOWED_HOSTS", "testserver,localhost")
os.environ.setdefault("DB_NAME", "postgres")
os.environ.setdefault("DB_USER", "postgres")
os.environ.setdefault("DB_PASSWORD", "postgres")
os.environ.setdefault("DB_HOST", "127.0.0.1")
os.environ.setdefault("DB_PORT", "54322")
# The local stack speaks plain TCP; a hosted pooler needs sslmode=require.
os.environ.setdefault("DB_SSLMODE", "")
os.environ.setdefault("SUPABASE_URL", "http://127.0.0.1:54321")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-at-least-32-characters-long")
os.environ.setdefault("SUPABASE_JWT_AUDIENCE", "authenticated")
os.environ.setdefault("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
os.environ.setdefault("CSRF_TRUSTED_ORIGINS", "http://localhost:3000")

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
