# EduAI backend — Django REST API

The new service. It owns everything the 4-week hybrid plan adds: the four-tier
RBAC hierarchy, B2B school onboarding and the Super Admin console, the B2C
parent portal, payments, and a server-side OpenAI proxy.

It does **not** own the existing product surface. The Next.js app in
`../frontend` keeps serving grading, worksheet and assessment generation, OCR,
credits and sharing exactly as it does today.

## Layout

```
backend/
├── manage.py
├── pyproject.toml            ruff + pytest configuration
├── requirements/
│   ├── base.txt              runtime
│   ├── dev.txt               + pytest, ruff, stubs
│   └── prod.txt              + whitenoise
├── config/                   the project, not a feature
│   ├── settings/
│   │   ├── base.py           shared; every secret read from the environment
│   │   ├── dev.py            DEBUG, browsable API, console email
│   │   ├── test.py           hermetic defaults, throttling off
│   │   └── prod.py           HSTS, SSL redirect, JSON-only renderer
│   ├── urls.py               /health + the /api/v1/ namespace
│   ├── wsgi.py
│   └── asgi.py
├── apps/                     one package per bounded context
│   ├── common/               base viewsets, pagination, error envelope, tenancy
│   ├── accounts/             Supabase-JWT auth bridge + RBAC permissions
│   ├── schools/              registration, approve/reject/suspend, directory
│   ├── billing/              plans, subscriptions, payments, invoices, webhooks
│   ├── parents/              parent-student links, invite codes, dashboard
│   ├── aiproxy/              OpenAI proxy + PII scrubbing
│   └── audit/                privileged-action audit trail
├── scripts/
│   └── bootstrap_schema.sql  creates the `django` schema, once per database
└── tests/                    cross-app tests; per-app tests live in apps/*/tests
```

## Setup

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements/dev.txt
cp .env.example .env          # then fill it in

psql "$PSQL_URL" -f scripts/bootstrap_schema.sql       # once per database
python manage.py migrate
python manage.py runserver 8000
```

From the repo root, `make install-backend`, `make db-bootstrap`, `make migrate`
and `make dev-backend` do the same things.

## Conventions

**Settings are selected explicitly.** There is no "default" environment that
quietly works in production. `manage.py` defaults to `config.settings.dev`;
`wsgi.py` and `asgi.py` default to `config.settings.prod`.

**No secret has a working default.** `base.py` reads every credential through
`django-environ` with no fallback, so a missing value fails at boot rather than
silently running with a placeholder.

**Environment names follow the house convention** shared with the other EduAI
services: unprefixed Django core settings (`SECRET_KEY`, `DEBUG`,
`ALLOWED_HOSTS`), split database parts (`DB_HOST`, `DB_NAME`, ...) rather than
one URL, and `MAIL_*` for SMTP. Django's own setting names are fixed, so
`prod.py` maps `MAIL_SERVER` onto `EMAIL_HOST` and so on.

**Django does not own the application schema.** The SQL migrations in
`../supabase/migrations` do. Django's own tables (`django_migrations`,
`auth_*`, content types) are created in a separate `django` Postgres schema via
`search_path`, and every model that maps an existing table is declared
`managed = False`. `manage.py migrate` is therefore a no-op against `public` -
each operation reports `-- (no-op)`, which `manage.py sqlmigrate <app> 0001`
will show you. See `docs/ARCHITECTURE.md` for the full rule.

Derive a model with `manage.py inspectdb <table>`, never by hand, and check it
with `manage.py verify_mapping` - which compares every model field against the
live database and exits non-zero on drift.

**Django cannot create a user.** `public.users.id` references `auth.users.id`,
so identity is Supabase's to create and Django's only to profile.

**Identity comes from Supabase.** `apps/accounts/authentication.py` verifies the
Supabase-issued JWT — signature, expiry, audience — and produces a
`SupabasePrincipal`. Django never issues credentials, and `django.contrib.auth`
is not the user model. Authorisation claims are read from `app_metadata`, never
`user_metadata`, which the user can write to.

**Deny by default.** `DEFAULT_PERMISSION_CLASSES` is `IsAuthenticated`; a public
endpoint opts out explicitly. Tenant scoping is a queryset-layer concern —
inherit `apps.common.permissions.TenantScopedQuerySetMixin` rather than
filtering by hand in a view.

**Logs carry metadata only.** Never log a raw OpenAI prompt or response, or a
payment payload; both can carry student PII.

## Testing

```bash
python -m pytest              # or: make test-backend
ruff check . && ruff format --check .
DJANGO_SETTINGS_MODULE=config.settings.prod python manage.py check --deploy
```

The suite runs on a fresh clone with no `.env` — `config/settings/test.py`
supplies throwaway defaults before settings load.
