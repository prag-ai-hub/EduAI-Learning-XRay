"""Settings shared by every environment.

Every secret is read from the environment (django-environ). Nothing sensitive
is ever defaulted to a working value here - a missing secret must fail loudly
rather than silently fall back.
"""

from pathlib import Path

import environ

# backend/config/settings/base.py -> backend/
BASE_DIR = Path(__file__).resolve().parents[2]

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, []),
    CORS_ALLOWED_ORIGINS=(list, []),
    DJANGO_DB_SCHEMA=(str, "django"),
    DJANGO_DB_CONN_MAX_AGE=(int, 60),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")

# --------------------------------------------------------------------------
# Applications
# --------------------------------------------------------------------------
DJANGO_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "corsheaders",
]

# One app per bounded context. Keep a feature's models, serializers, views,
# permissions and tests inside its own app - never spread across apps.
LOCAL_APPS = [
    "apps.common",  # base viewsets, pagination, tenancy mixins, health
    "apps.accounts",  # Supabase-JWT auth bridge + 4-tier RBAC permissions
    "apps.schools",  # B2B onboarding and the Super Admin console
    "apps.billing",  # plans, subscriptions, payments, invoices, webhooks
    "apps.parents",  # parent-student links, invite codes, parent dashboard
    "apps.aiproxy",  # server-side OpenAI proxy with PII scrubbing
    "apps.audit",  # audit trail for privileged admin actions
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    # The API authenticates with a bearer token, never a cookie, so CSRF is
    # not the attack this service faces. The middleware stays in anyway: DRF
    # views are csrf_exempt so nothing here is affected, and its absence would
    # otherwise be indistinguishable from having forgotten it.
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
            ],
        },
    },
]

# --------------------------------------------------------------------------
# Database - the EXISTING Supabase-hosted Postgres. No data migration.
#
# search_path puts Django's own bookkeeping tables (django_migrations,
# auth_*, django_content_type) in a dedicated `django` schema so they never
# mix with the application schema that Next.js and the SQL migrations in
# ../supabase/migrations own. Reads of existing tables fall through to
# `public` because it stays second on the path.
#
# Run backend/scripts/bootstrap_schema.sql once per database first.
# --------------------------------------------------------------------------
DATABASES = {
    "default": {
        **env.db("DATABASE_URL"),
        "CONN_MAX_AGE": env("DJANGO_DB_CONN_MAX_AGE"),
        "OPTIONS": {
            "options": f"-c search_path={env('DJANGO_DB_SCHEMA')},public",
        },
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

# --------------------------------------------------------------------------
# Django REST Framework
# --------------------------------------------------------------------------
REST_FRAMEWORK = {
    # Identity is Supabase's. Django verifies the Supabase-issued JWT rather
    # than issuing sessions of its own - see apps/accounts/authentication.py.
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.SupabaseJWTAuthentication",
    ],
    # Deny by default. An endpoint that should be public opts out explicitly.
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_VERSIONING_CLASS": "rest_framework.versioning.NamespaceVersioning",
    "DEFAULT_VERSION": "v1",
    "ALLOWED_VERSIONS": ["v1"],
    "DEFAULT_PAGINATION_CLASS": "apps.common.pagination.DefaultPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "30/min",
        "user": "120/min",
        "auth": "10/min",  # sign-in / registration surfaces
        "ai": "20/min",  # the OpenAI proxy - caps runaway spend
        "webhook": "300/min",  # gateway retries must not be throttled away
    },
    "EXCEPTION_HANDLER": "apps.common.exceptions.api_exception_handler",
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

# --------------------------------------------------------------------------
# Supabase auth bridge
# --------------------------------------------------------------------------
SUPABASE_URL = env("SUPABASE_URL")
SUPABASE_JWT_SECRET = env("SUPABASE_JWT_SECRET")
SUPABASE_JWT_ALGORITHMS = ["HS256"]
SUPABASE_JWT_AUDIENCE = env("SUPABASE_JWT_AUDIENCE", default="authenticated")

# --------------------------------------------------------------------------
# Third-party service credentials (never hardcoded, never returned in a response)
# --------------------------------------------------------------------------
OPENAI_API_KEY = env("OPENAI_API_KEY", default="")
OPENAI_MODEL = env("OPENAI_MODEL", default="")

PAYMENT_GATEWAY_KEY_ID = env("PAYMENT_GATEWAY_KEY_ID", default="")
PAYMENT_GATEWAY_KEY_SECRET = env("PAYMENT_GATEWAY_KEY_SECRET", default="")
PAYMENT_GATEWAY_WEBHOOK_SECRET = env("PAYMENT_GATEWAY_WEBHOOK_SECRET", default="")

# --------------------------------------------------------------------------
# CORS - the Cloudflare-hosted frontend origin only.
# --------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = False  # the frontend sends a bearer token, not cookies

# --------------------------------------------------------------------------
# I18N / static
# --------------------------------------------------------------------------
LANGUAGE_CODE = "en-in"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# --------------------------------------------------------------------------
# Logging - metadata only. Never log a raw OpenAI prompt/response or any
# payment payload; both can carry student PII or card data.
# --------------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "standard"},
    },
    "root": {"handlers": ["console"], "level": env("DJANGO_LOG_LEVEL", default="INFO")},
}
