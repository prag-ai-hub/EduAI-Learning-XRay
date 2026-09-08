# EduAI Learning X-Ray — repository map

Folder-by-folder layout. This page describes **where code lives**; for how a
request flows, who may read which row, and what the deployment targets are, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Where the two disagree, the code
is correct.

## Orientation — two deployables in one repo

| Target | What it is | Entry |
|---|---|---|
| `backend/` | Django 5.2 + DRF REST API over Supabase Postgres. Owns every credential; the only thing that talks to an LLM provider. | `manage.py` → `eduai_backend/` |
| `app/` | Expo client — web, iOS and Android from one codebase. Expo Router, including its server-side API routes. | `src/app/_layout.tsx` |

`frontend/` is the retiring Next.js web app. Its API routes and libraries have
already moved into `app/`; its screens are still being ported. It will be
deleted once they are, and nothing new should be added to it.

## Top level

```
EduAI-Learning-X-Ray/
├── backend/                    Django REST API — the server
├── app/                        Expo client — web + iOS + Android
├── frontend/                   Next.js web app — RETIRING, do not extend
├── supabase/                   Shared Postgres schema: SQL migrations + local stack
├── docs/                       Architecture, deployment, testing, the delivery plan
├── scripts/                    Repo-level database and release scripts
│
├── CLAUDE.md                   Working rules for this repo (read first)
├── PROJECT_ARCHITECTURE_GUIDE.md   This file
├── README.md                   Setup + feature overview
└── Makefile                    Every task, for every workspace, from the root
```

## backend/

One Django project (`eduai_backend`), every feature app grouped under
`apps/<group>/<app>/`.

```
backend/
├── manage.py
├── requirements.txt            The ONE dependency file. A new import goes here.
├── pyproject.toml              ruff + pytest configuration
├── conftest.py                 Database fixtures for the whole suite
├── start.sh                    Local dev launcher
├── Dockerfile  gunicorn.conf.py
│
├── eduai_backend/              The Django project package
│   ├── settings/
│   │   ├── base.py             INSTALLED_APPS (annotated with the groups), DB, DRF
│   │   ├── dev.py  test.py  prod.py
│   ├── urls.py                 Root URL router — the API surface index
│   └── asgi.py  wsgi.py
│
├── apps/
│   ├── common/                 cross-cutting: base viewsets, pagination, health,
│   │                           security middleware, deploy checks (eduai.E001-E006)
│   ├── accounts/               identity: the Supabase-JWT bridge + capability matrix
│   │
│   ├── tenants/                THE TENANT GROUP
│   │   ├── schools/            TENANT ROOT — School, Student, support grants,
│   │   │                       tenancy.py, filters.py, notifications.py
│   │   └── parents/            parent-student links, invite codes
│   │
│   ├── platform/               infrastructure services with no domain of their own
│   │   ├── aiproxy/            the ONLY route to an LLM provider; PII scrubbing
│   │   └── audit/              audit trail for privileged actions
│   │
│   └── billing/
│       └── subscriptions/      plans, credits, payments, invoices  (label: billing)
│
├── templates/emails/schools/   Registration and lifecycle email templates
├── deploy/                     systemd unit for the gunicorn service
├── scripts/                    bootstrap_schema.sql
├── logs/                       Runtime log output (gitignored)
└── tests/                      Repo-level tests: requirements, schema ownership,
                                choice parity with the SQL migrations
```

### Standard files inside an app

| File | Role |
|---|---|
| `models.py` | Tables. **Every model is `managed = False`** — `supabase/migrations` creates them, not Django. |
| `views.py` | DRF views. Every one declares explicit `permission_classes`. |
| `serializers.py` | The validation boundary. `school_id`, `role` and prices are derived server-side, never trusted from the body. |
| `permissions.py` | Capability checks. Authority does **not** flow downward — see below. |
| `urls.py` | App-local routes, mounted by `eduai_backend/urls.py`. |
| `services.py` | Business logic kept out of views. |
| `tests/` | One file per subject, not a single `tests.py`. |

### A group is a package, not an app

`apps/tenants/` and `apps/platform/` hold no code of their own — only their
leaves are in `INSTALLED_APPS`. Load order matters: `tenants.schools` is the
tenant root, and anything holding a FK to `schools.School` must come after it.

**App labels are pinned, not derived.** Models point at each other by label
(`"billing.Plan"`, `"schools.School"`), and `django_migrations` records the
label too. `apps.billing.subscriptions` therefore sets `label = "billing"`
explicitly; moving a directory must never change a label.

### URL prefix → app

| Prefix | Handled by |
|---|---|
| `/health` | `apps.common.views.health` — unversioned, exempt from the TLS redirect |
| `/api/v1/accounts/` | `apps.accounts` |
| `/api/v1/schools/` | `apps.tenants.schools` |
| `/api/v1/parents/` | `apps.tenants.parents` |
| `/api/v1/ai/` | `apps.platform.aiproxy` |
| `/api/v1/audit/` | `apps.platform.audit` |
| `/api/v1/billing/` | `apps.billing.subscriptions` |

## app/

Feature-sliced. `src/features/<feature>/` owns its own API calls, screens and
components; only `src/shared/` and `src/app/` are cross-cutting.

```
app/
├── app.json  package.json  tsconfig.json  metro.config.js
├── assets/  scripts/
└── src/
    ├── app/                    THE EXPO ROUTER ROUTE TREE — a file here is a route
    │   ├── _layout.tsx  index.tsx
    │   └── api/**+api.ts       20 server-side API routes (run on the server only)
    │
    ├── shared/                 cross-feature only
    │   ├── api/                client.ts · errors.ts · types.ts · net.ts ·
    │   │                       django.ts · supabase.ts
    │   ├── components/         form.tsx, themed-*, ui/
    │   ├── navigation/         app-tabs
    │   ├── hooks/              use-color-scheme · use-theme
    │   ├── theme/              styles.ts (the ported design system) · tokens.ts
    │   ├── storage/            keychain on native, async storage on web
    │   └── files/              IndexedDB on web, expo-file-system on native
    │
    ├── features/               one slice per feature — see src/features/README.md
    │   └── auth/               api/authApi.ts (authFetch) · roles.ts
    │
    └── server/                 SERVER-ONLY. Imported by src/app/api/**+api.ts and
                                nothing else; must never reach a client bundle.
                                supabase-server · supabase-auth · authorization ·
                                ai-proxy · document-text · evaluator-grading ·
                                share-tokens
```

`src/app/` means the route tree, because that is what Expo Router requires. It
plays the role the reference layout gives to `src/app/navigation/`. App-wide
providers cannot live there — a file under `src/app/` becomes a route — so they
go in `src/providers/`.

## Rules of the road

| You are adding… | It goes here |
|---|---|
| A backend LLM call | Through `apps.platform.aiproxy.services` only — never an OpenAI/Mistral SDK call in app code. |
| A tenant-scoped table | `supabase/migrations` first, then an unmanaged model with a `school` FK, after `tenants.schools` in `INSTALLED_APPS`. |
| A Python dependency | `backend/requirements.txt`, pinned. `backend/tests/test_requirements.py` fails the build otherwise. |
| A backend endpoint | An app under the right group, mounted in `eduai_backend/urls.py` under `/api/v1/`. Declare `permission_classes`. |
| A frontend screen | `app/src/features/<feature>/screens/`, with a thin route file in `app/src/app/`. |
| A frontend network call | `authFetch` from `features/auth/api/authApi.ts` — it owns the bearer token and the 401 refresh. Never bare `fetch`, never a relative URL. |
| Something two features need | `app/src/shared/`. If only one feature needs it, it stays in that slice. |
| A secret | The backend `.env`, read through `django-environ`. The client gets `EXPO_PUBLIC_*` only, and those are not secrets. |

## Key files

| Path | Why it matters |
|---|---|
| `backend/eduai_backend/settings/base.py` | `INSTALLED_APPS` is annotated with the group structure and the load-order rule. |
| `backend/eduai_backend/urls.py` | The whole API surface in one screen. |
| `backend/apps/accounts/capabilities.py` | The capability matrix. Authority does not flow downward: only Teacher holds `TEACHING_GRADING_RUN`, so a SchoolAdmin cannot grade. |
| `backend/apps/accounts/authentication.py` | Verifies the Supabase JWT, then resolves role/school/status from `public.users`. Django cannot create users. |
| `backend/apps/tenants/schools/tenancy.py` | `require_school_scope`, `require_linked_child`, `granted_school_ids` — which rows, for whom. |
| `backend/apps/platform/aiproxy/services.py` | The single provider router. Keys live here and nowhere else. |
| `backend/apps/platform/aiproxy/scrubbing.py` | PII redaction applied before any prompt leaves the building. |
| `backend/apps/common/checks.py` | Deploy checks `eduai.E001`–`E006`, registered from `AppConfig.ready()`. |
| `app/src/shared/api/net.ts` | Base-URL resolution and the authed transport. The 29 relative URLs that worked on web and broke on device were centralised here. |
| `app/src/features/auth/api/authApi.ts` | What feature code imports. Every client request goes through it. |

## Things the tree does not tell you

* **The screens have not been ported yet.** `frontend/app/ui/` still holds
  ~2,500 lines and 72 components. `app/` renders the route scaffold and the
  server routes; the product UI arrives with the port.
* **Schema ownership is one-way.** `supabase/migrations` is the only thing that
  creates or alters an application table. Django's own bookkeeping tables live
  in a separate `django` Postgres schema, reached via `search_path`.
* **SuperAdmin has no implicit cross-tenant access.** Reading another school's
  rows requires a `SupportAccessGrant` that expires, and the read is audited.
* **Tests run against the configured database, not a fresh one.** The tables are
  unmanaged, so pytest-django's create-and-migrate would produce an empty
  schema. `conftest.py` refuses a non-local host and skips when nothing listens.
