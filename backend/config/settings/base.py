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
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, []),
    CORS_ALLOWED_ORIGINS=(list, []),
    CSRF_TRUSTED_ORIGINS=(list, []),
    CORS_ALLOW_CREDENTIALS=(bool, False),
    DB_PORT=(int, 5432),
    DB_SSLMODE=(str, "require"),
    DB_SCHEMA=(str, "django"),
    DB_CONN_MAX_AGE=(int, 60),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")

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
    "apps.common.middleware.ApiSecurityHeadersMiddleware",
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
        "ENGINE": env("DB_ENGINE", default="django.db.backends.postgresql"),
        "NAME": env("DB_NAME"),
        "USER": env("DB_USER"),
        "PASSWORD": env("DB_PASSWORD"),
        "HOST": env("DB_HOST"),
        "PORT": env("DB_PORT"),
        "CONN_MAX_AGE": env("DB_CONN_MAX_AGE"),
        "OPTIONS": {
            # Django's own bookkeeping tables go in DB_SCHEMA; reads of the
            # application tables fall through to public, which stays second.
            "options": f"-c search_path={env('DB_SCHEMA')},public",
            **({"sslmode": env("DB_SSLMODE")} if env("DB_SSLMODE") else {}),
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
# Where this service answers, and where the web app lives. Used to build
# absolute links in outbound email and in API documentation - a relative link
# in an email goes nowhere.
DEFAULT_FROM_EMAIL = env("MAIL_DEFAULT_SENDER", default="no-reply@eduaihub.in")

API_BASE_URL = env("API_BASE_URL", default="")
FRONTEND_URL = env("FRONTEND_URL", default="")

SUPABASE_URL = env("SUPABASE_URL")
SUPABASE_JWT_SECRET = env("SUPABASE_JWT_SECRET")
SUPABASE_JWT_ALGORITHMS = ["HS256"]
SUPABASE_JWT_AUDIENCE = env("SUPABASE_JWT_AUDIENCE", default="authenticated")

# --------------------------------------------------------------------------
# Third-party service credentials (never hardcoded, never returned in a response)
# --------------------------------------------------------------------------
OPENAI_API_KEY = env("OPENAI_API_KEY", default="")
OPENAI_MODEL = env("OPENAI_MODEL", default="")
OPENAI_BASE_URL = env("OPENAI_BASE_URL", default="https://api.openai.com/v1")

# OCR for scanned answer sheets. Same rule as the OpenAI key: server-side only,
# never returned in a response.
MISTRAL_API_KEY = env("MISTRAL_API_KEY", default="")
MISTRAL_BASE_URL = env("MISTRAL_BASE_URL", default="https://api.mistral.ai/v1")
MISTRAL_OCR_MODEL = env("MISTRAL_OCR_MODEL", default="mistral-ocr-latest")

PAYMENT_GATEWAY_KEY_ID = env("PAYMENT_GATEWAY_KEY_ID", default="")
PAYMENT_GATEWAY_KEY_SECRET = env("PAYMENT_GATEWAY_KEY_SECRET", default="")
PAYMENT_GATEWAY_WEBHOOK_SECRET = env("PAYMENT_GATEWAY_WEBHOOK_SECRET", default="")

# --------------------------------------------------------------------------
# CORS - the Cloudflare-hosted frontend origin only.
# --------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
# The API takes a bearer token, not a cookie, so credentials stay off unless an
# operator has a specific reason. Turning it on with a wildcard origin is the
# combination browsers refuse outright.
CORS_ALLOW_CREDENTIALS = env("CORS_ALLOW_CREDENTIALS")
# Origins allowed to submit unsafe methods. Needed for the browsable API and
# the admin when either is reached through a tunnel or a non-default host.
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS")

# CORS applies to the API only. /health is a plain probe and needs no
# cross-origin story; narrowing the regex keeps the header off everything else.
CORS_URLS_REGEX = r"^/api/.*$"
# Only what the frontend actually sends. An open list is an invitation to
# probe for endpoints that accept something unusual.
CORS_ALLOW_METHODS = ("GET", "POST", "PATCH", "DELETE", "OPTIONS")
CORS_ALLOW_HEADERS = ("authorization", "content-type", "accept", "origin")

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
