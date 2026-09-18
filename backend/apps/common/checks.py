"""Deployment checks that refuse a dangerously open configuration.

`manage.py check --deploy` already warns about Django's own settings. These
cover the ones specific to this service, and they are errors rather than
warnings: a wildcard CORS origin on an API that reads student data is not a
style preference, and a warning in a deploy log is something nobody reads.

They only fire when DEBUG is off, so local development is untouched.
"""

from __future__ import annotations

from importlib.util import find_spec

from django.conf import settings
from django.core.checks import Error, register
from django.utils.module_loading import import_string

WILDCARD = "*"


@register(deploy=True)
def cors_is_not_wildcarded(app_configs, **kwargs):
    """CORS must name real origins in production."""
    if settings.DEBUG:
        return []

    errors = []
    origins = list(settings.CORS_ALLOWED_ORIGINS or [])

    if not origins:
        errors.append(
            Error(
                "CORS_ALLOWED_ORIGINS is empty.",
                hint="Name the frontend origin(s). An empty list blocks the browser "
                "app entirely, which usually means the variable was not set.",
                id="eduai.E001",
            )
        )
    if any(WILDCARD in origin for origin in origins):
        errors.append(
            Error(
                "CORS_ALLOWED_ORIGINS contains a wildcard.",
                hint="List each origin. A wildcard lets any site call this API with "
                "a user's token.",
                id="eduai.E002",
            )
        )
    if settings.CORS_ALLOW_CREDENTIALS and any(WILDCARD in o for o in origins):
        errors.append(
            Error(
                "CORS_ALLOW_CREDENTIALS is on with a wildcard origin.",
                hint="Browsers refuse this combination outright; it is always a misconfiguration.",
                id="eduai.E003",
            )
        )
    return errors


@register(deploy=True)
def allowed_hosts_is_not_wildcarded(app_configs, **kwargs):
    """ALLOWED_HOSTS must name real hosts in production."""
    if settings.DEBUG:
        return []
    if WILDCARD in (settings.ALLOWED_HOSTS or []):
        return [
            Error(
                "ALLOWED_HOSTS is a wildcard.",
                hint="Name the hosts this service answers on. A wildcard allows "
                "Host-header attacks against password reset and absolute links.",
                id="eduai.E004",
            )
        ]
    return []


@register(deploy=True)
def secrets_are_not_placeholders(app_configs, **kwargs):
    """Catch a .env that was copied but never filled in."""
    if settings.DEBUG:
        return []

    errors = []
    if "not-a-real-secret" in settings.SECRET_KEY or len(settings.SECRET_KEY) < 40:
        errors.append(
            Error(
                "SECRET_KEY looks like a placeholder or is too short.",
                hint="Generate one with get_random_secret_key().",
                id="eduai.E005",
            )
        )
    if not settings.SUPABASE_JWT_SECRET:
        errors.append(
            Error(
                "SUPABASE_JWT_SECRET is empty - every request would fail to authenticate.",
                id="eduai.E006",
            )
        )
    return errors


@register(deploy=True)
def cache_backend_is_importable(app_configs, **kwargs):
    """The cache backend is named as a string, so a missing driver fails late.

    Django resolves `CACHES["default"]["BACKEND"]` by name and imports the
    client library lazily - `import redis` sits inside `RedisCacheClient.
    __init__`, reached only through `RedisCache._cache` on the first cache
    operation. So setting REDIS_URL without the `redis` package builds, boots,
    passes every other check and answers /health, then returns 500 on the first
    throttled request. That is every endpoint in this API, and /health staying
    green is what hides it from the load balancer.

    Nothing else catches this: `tests/test_requirements.py` reads imports out of
    source, and no source file imports the driver.

    Two halves, because the failure has two shapes. `import_string` catches a
    backend whose own module is missing or misspelled. The map catches Django's
    built-ins, whose class imports cleanly while the driver underneath does not.
    Deliberately no I/O: a deploy check that dials the cache would hang a
    release when the cache is merely down, which is a different fault.
    """
    #: backend path -> the distribution's import name. Django ships five cache
    #: backends; these are the three needing a third-party driver.
    drivers = {
        "django.core.cache.backends.redis.RedisCache": "redis",
        "django.core.cache.backends.memcached.PyMemcacheCache": "pymemcache",
        "django.core.cache.backends.memcached.PyLibMCCache": "pylibmc",
    }

    errors = []
    for alias, config in (settings.CACHES or {}).items():
        backend = config.get("BACKEND")
        if not backend:
            continue
        try:
            import_string(backend)
        except ImportError as exc:
            errors.append(
                Error(
                    f"CACHES[{alias!r}] names {backend!r}, which cannot be imported: {exc}",
                    hint="Check the spelling, or install the package providing it.",
                    id="eduai.E007",
                )
            )
            continue

        driver = drivers.get(backend)
        if driver and find_spec(driver) is None:
            errors.append(
                Error(
                    f"CACHES[{alias!r}] uses {backend!r}, but its driver "
                    f"{driver!r} is not installed.",
                    hint=(
                        f"Add `{driver}` to backend/requirements.txt, pinned, and rebuild "
                        "the image. Django imports it lazily, so without this the service "
                        "starts healthy and then 500s on the first throttled request."
                    ),
                    id="eduai.E007",
                )
            )
    return errors


@register(deploy=True)
def throttle_cache_is_shared(app_configs, **kwargs):
    """A per-process throttle counter is not a rate limit.

    DRF keeps throttle state in the default cache. LocMemCache is per PROCESS,
    so under N gunicorn workers every limit is silently N times looser and each
    counter resets when its worker recycles. `settings/prod.py` falls back to
    LocMemCache whenever REDIS_URL is empty, which is exactly the configuration
    an operator ends up with by not setting one.

    That matters most where a throttle is the only control there is.
    `/api/v1/parents/links/redeem` takes a ten-character invite code and grants a
    parent access to a named child's reports; nothing else stands between a
    guessing attacker and that link, so a limit of 10/hour that is really
    10/hour/worker and forgets itself on restart is the difference between the
    endpoint being defended and appearing to be.

    eduai.E007 asks whether the cache backend can be imported at all. This asks
    whether it is shared, which is a different question with the same symptom -
    everything works, quietly and wrongly.
    """
    backend = (settings.CACHES or {}).get("default", {}).get("BACKEND", "")
    if not backend.endswith("locmem.LocMemCache"):
        return []
    return [
        Error(
            "The default cache is LocMemCache, which is per-process, so every "
            "throttle is per-worker rather than per-deployment.",
            hint=(
                "Set REDIS_URL to a shared cache. The invite-code redemption "
                "limit is the only brute-force control on parent-child linking; "
                "per-worker it is as loose as the worker count and resets on "
                "every restart."
            ),
            id="eduai.E008",
        )
    ]


@register(deploy=True)
def admin_is_not_exposed_insecurely(app_configs, **kwargs):
    """The back office is a session-cookie login over the public internet.

    A Django superuser edits any school's rows directly, with none of the
    capability matrix in front of them. Two conditions make that acceptable in
    production and both are checkable: the session cookie must not travel in
    clear, and the site must not be in DEBUG. A third is a judgement and only a
    warning: `/admin/` is the first path a scanner tries.
    """
    if settings.DEBUG or not getattr(settings, "ADMIN_ENABLED", False):
        return []

    errors = []
    if not getattr(settings, "SESSION_COOKIE_SECURE", False):
        errors.append(
            Error(
                "The admin is enabled and SESSION_COOKIE_SECURE is off.",
                hint="An admin session cookie sent over plain HTTP hands somebody the whole "
                "database. Set SESSION_COOKIE_SECURE, or disable the admin with "
                "DJANGO_ADMIN_ENABLED=False.",
                id="eduai.E009",
            )
        )
    if not getattr(settings, "CSRF_COOKIE_SECURE", False):
        errors.append(
            Error(
                "The admin is enabled and CSRF_COOKIE_SECURE is off.",
                hint="Set CSRF_COOKIE_SECURE, or disable the admin.",
                id="eduai.E009",
            )
        )
    return errors
