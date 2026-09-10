"""Settings shared by every environment.

Every secret is read from the environment (django-environ). Nothing sensitive
is ever defaulted to a working value here - a missing secret must fail loudly
rather than silently fall back.
"""

from pathlib import Path

import environ

# backend/eduai_backend/settings/base.py -> backend/
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

# Apps are grouped by domain: apps/<group>/<app>/. A group is a package, not
# an app - only the leaves below are installed.
#
# Load order matters. `tenants.schools` is the tenant root; anything holding a
# FK to schools.School must come after it.
LOCAL_APPS = [
    # cross-cutting, no group
    "apps.common",  # base viewsets, pagination, health, security middleware
    "apps.accounts",  # Supabase-JWT auth bridge + the capability matrix
    # tenants - the tenant root and the relationships scoped to it
    "apps.tenants.schools",  # TENANT ROOT: School, Student, support grants, tenancy
    "apps.tenants.parents",  # parent-student links, invite codes, parent dashboard
    # platform - infrastructure services, no domain of their own
    "apps.platform.aiproxy",  # the ONLY route to an LLM provider; PII scrubbing
    "apps.platform.audit",  # audit trail for privileged actions
    # billing
    "apps.billing.subscriptions",  # plans, subscriptions, payments, invoices
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

ROOT_URLCONF = "eduai_backend.urls"
WSGI_APPLICATION = "eduai_backend.wsgi.application"
ASGI_APPLICATION = "eduai_backend.asgi.application"

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
# The OCR endpoint accepts a base64 data URL of a scanned answer sheet, capped
# at 15 MB by OcrSerializer.MAX_DATA_URL. Django's own default is 2.5 MB and it
# rejects the body in the request parser, before any view or serializer runs -
# so without this the serializer's documented limit is unreachable and a teacher
# uploading a phone photo gets a generic "request body exceeded" that says
# nothing about OCR. A phone photo is 3-8 MB before base64 adds a third.
#
# Sized as 15 MB + base64 overhead + JSON envelope. Raising OcrSerializer's cap
# without raising this one silently reinstates the 2.5 MB ceiling.
#
# Worth knowing before raising it further: DRF validates a CharField with
# ProhibitSurrogateCharactersValidator, a Python generator calling ord() once
# per character, so a 15 MB body costs roughly 1.5 s of CPU in that validator
# alone and holds a gunicorn worker for the duration.
DATA_UPLOAD_MAX_MEMORY_SIZE = 24 * 1024 * 1024

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
        # Checkout creates an order at the gateway. Idempotency already stops a
        # double-clicked Pay button creating two of them; this stops a script
        # from filling the gateway's dashboard with abandoned orders.
        "checkout": "12/min",
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

# Supabase signs access tokens two ways and a project can move between them.
#
#   HS256  the legacy shared secret below. One symmetric key, and anything that
#          can verify a token can also mint one.
#   ES256  the current default once a project has signing keys - asymmetric,
#          with a `kid` naming a public key published at the JWKS URL. We can
#          verify and cannot forge, which is the point.
#
# Both are accepted because which one arrives is the project's setting, not
# ours, and a project that rotates to signing keys must not take the API down.
# The algorithm is never taken from the token: the header only chooses WHICH
# allowlisted verifier runs, so `alg: none`, or an RS256 token replayed as HS256
# against the public key, cannot get through. See apps/accounts/authentication.
SUPABASE_JWT_SECRET = env("SUPABASE_JWT_SECRET", default="")
SUPABASE_JWT_ALGORITHMS = ["HS256"]
SUPABASE_JWT_ASYMMETRIC_ALGORITHMS = ["ES256", "RS256", "EdDSA"]
SUPABASE_JWKS_URL = env(
    "SUPABASE_JWKS_URL",
    default=f"{SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else "",
)
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

# Razorpay, reached over its REST API - see apps/billing/subscriptions/gateway.py.
# The names stay gateway-neutral so a second provider is a settings change and a
# new client module, not a rename across the codebase.
#
# KEY_ID is the publishable half: the browser checkout script needs it, and the
# checkout endpoint returns it deliberately. KEY_SECRET and WEBHOOK_SECRET are
# server-side only and must never appear in a response or a log line.
PAYMENT_GATEWAY_KEY_ID = env("PAYMENT_GATEWAY_KEY_ID", default="")
PAYMENT_GATEWAY_KEY_SECRET = env("PAYMENT_GATEWAY_KEY_SECRET", default="")
PAYMENT_GATEWAY_WEBHOOK_SECRET = env("PAYMENT_GATEWAY_WEBHOOK_SECRET", default="")
PAYMENT_GATEWAY_BASE_URL = env("PAYMENT_GATEWAY_BASE_URL", default="https://api.razorpay.com/v1")

# --------------------------------------------------------------------------
# GST - hooks, not tax advice.
#
# docs/plan/02-PAYMENT-DATA-MODEL.md §4 is explicit that every rate, SAC code
# and place-of-supply rule is the accountant's call, confirmed before go-live.
# So none of these carries a default that looks like an answer: an empty seller
# state or an unset rate makes checkout return 503 "not configured" rather than
# quietly issuing a 0%-tax invoice that someone has to unwind later. A wrong
# number defaulted here would be indistinguishable from a decision.
#
# The rate is stored on each invoice row as it is charged, never read back from
# settings by a renderer - a rate change must not rewrite history.
# --------------------------------------------------------------------------
#: Two-digit GST state code of the seller's registered place of business. Drives
#: CGST+SGST (intra-state) versus IGST (inter-state).
GST_SELLER_STATE_CODE = env("GST_SELLER_STATE_CODE", default="")
#: The seller's own 15-character GSTIN, printed on every invoice.
GST_SELLER_GSTIN = env("GST_SELLER_GSTIN", default="")
#: Service Accounting Code for what is being sold. 997331 and 998434 are both
#: plausible for SaaS; which one applies is not ours to decide.
GST_SAC_CODE = env("GST_SAC_CODE", default="")
#: Basis points: 1800 would be 18%. None means "nobody has said yet".
GST_RATE_BPS = env.int("GST_RATE_BPS", default=None)

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
