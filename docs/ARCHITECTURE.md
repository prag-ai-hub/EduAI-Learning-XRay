# Architecture

EduAI Learning X-Ray is a **hybrid**: an existing Next.js application that keeps
serving the product it already serves, and a new Django REST service that owns
everything being added. They share one Postgres database and one identity
provider, and they talk to each other over HTTP and nothing else.

This document is the boundary contract. If a change blurs one of these lines,
it is the wrong change.

## The three top-level pieces

```
frontend/     Next.js 16 + React 19, deployed to Cloudflare Workers
backend/      Django 5.2 + DRF, deployed to a dedicated Python host
supabase/     Postgres schema (SQL migrations) + local stack config
```

`supabase/` sits beside the two services rather than inside either one,
because the database belongs to neither. Putting it under `frontend/` would
assert that the web app owns the schema — which stopped being true the moment
Django connected to the same database.

## Request flow

```
                    ┌──────────────────────────────┐
   browser ────────▶│  frontend/  (Cloudflare)     │
                    │  pages + the existing 17     │
                    │  API routes                  │
                    └───────┬──────────────┬───────┘
                            │              │
              Supabase JS   │              │  fetch, with the Supabase
              (anon key,    │              │  access token as a bearer
               RLS applies) │              │  token
                            ▼              ▼
                    ┌───────────────┐  ┌──────────────────────────┐
                    │ Supabase Auth │  │  backend/  (Python host) │
                    │  (identity)   │  │  DRF, /api/v1/*          │
                    └───────┬───────┘  └────────────┬─────────────┘
                            │  issues JWT           │  verifies that JWT
                            │                       │  (signature, exp, aud)
                            └───────────┬───────────┘
                                        ▼
                            ┌───────────────────────────┐
                            │  Supabase Postgres        │
                            │  public.*  ← supabase/    │
                            │  django.*  ← Django only  │
                            └───────────────────────────┘
```

**Supabase Auth is the only identity provider.** Django does not issue
credentials, does not have a login endpoint, and does not use
`django.contrib.auth.User` as the user model. It verifies the Supabase-issued
JWT on every request and turns the claims into a `SupabasePrincipal`
(`backend/apps/accounts/authentication.py`). This is what makes a new backend
affordable at all: no auth system is being rebuilt.

The database enforces that split. `public.users.id` carries a foreign key to
`auth.users.id` with `ON DELETE CASCADE` (M13), so **Django cannot create a
user** — an identity has to exist in Supabase Auth first. Registration flows
create the identity through Supabase and reach `public.users` only to attach
or update the profile. `role` and `school` are Django's to write; the row's
existence is not.

A second constraint shapes authorisation: `users_role_school_scope_check`
requires `school_id IS NOT NULL` for exactly SchoolAdmin and Teacher. A
SuperAdmin and a Parent both have no school, so **tenant filtering by
`school_id` does not apply to a parent** — every parent-facing query joins
through `parents.ParentStudentLink` instead, which is the only path from a
parent to a student.

Authorisation claims are read from the token's `app_metadata`, never
`user_metadata` — the latter is user-writable in Supabase, so trusting it for
`role` would let any signed-in parent promote themselves.

## Schema ownership

One database, two writers, one owner:

| Schema | Owned by | Changed by |
| --- | --- | --- |
| `public` | the product | `supabase/migrations/*.sql`, applied with the Supabase CLI |
| `django` | the Django framework | `manage.py migrate` |

Django's connection sets `search_path = django,public`. Its own bookkeeping
tables (`django_migrations`, `auth_*`, `django_content_type`) are created in
`django`; unqualified reads of application tables still resolve in `public`.
Run `backend/scripts/bootstrap_schema.sql` once per database to create the
schema.

**Django models that map an existing table must set `managed = False`.**
`plans`, `subscriptions`, `payments`, `payment_events`, `invoices`,
`parent_student_links`, `parent_invite_codes`, `schools` and `users` all
already exist, built by the SQL migrations. Letting Django `makemigrations`
them would produce a second, divergent definition of tables it does not own —
and on `migrate`, an attempt to create tables that are already there.

If Django needs a genuinely new application table, add it as a SQL migration in
`supabase/migrations` so the schema keeps one history, and map it unmanaged
like the rest.

Three things keep the mapping honest, and all three run in CI:

- `backend/tests/test_schema_ownership.py` fails if any model becomes managed,
  if any migration would emit DDL, or if `public` leads the search path.
- `backend/tests/test_choice_parity.py` reconciles every `TextChoices` against
  the CHECK constraint it mirrors, parsed straight out of the migration SQL —
  no database needed.
- `manage.py verify_mapping` checks every model field against the live
  database and exits non-zero on drift. Run it after applying new SQL
  migrations and in the deploy pipeline.

Re-derive a mapping with `manage.py inspectdb <table>` rather than editing it
by hand.

Two conventions apply to every new SQL migration, both learned from runtime
failures and both enforced by `frontend/tests/plpgsql-conventions.test.mjs`:

- **OUT parameters on table-returning plpgsql functions are `out_`-prefixed.**
  An OUT name that collides with a column the function touches makes references
  ambiguous — and it fails at runtime, not at deploy time.
- **Every user foreign key points at `public.users`, never `auth.users`.**
  `public.users` is the profile extension of `auth.users`, so the delete
  cascade runs through it.

## Authorisation

Three questions, answered in three separate places. Collapsing any two of them
is how "SuperAdmin" turns into "can read every school's student data".

| Question | Answered by | Notes |
| --- | --- | --- |
| Who is calling? | `backend/apps/accounts/authentication.py` | Token verified, then role/school/status read from `public.users`. The token proves identity, never authority. |
| May that role do this kind of thing? | `backend/apps/accounts/capabilities.py` | A transcription of `docs/plan/01-ROLE-PERMISSION-MATRIX.md` §2. |
| On which rows? | `backend/apps/common/tenancy.py` | School scope, support grants, parent links. |

**It is a capability matrix, not a rank ladder.** A SchoolAdmin outranks a
Teacher administratively and still cannot grade — the matrix says teacher
authority over marks "must not be delegable upward". `roles.py` therefore has no
rank helper, deliberately, so nobody can reach for one.

**Deny by default.** DRF's default permission is `HasCapability`, and a view
that declares no capability is refused rather than served — a missing
declaration is far likelier to be an oversight than an intent to publish an
endpoint. Inherit `TenantScopedViewSet` or `PlatformViewSet` from
`apps/common/viewsets.py` so scoping cannot be forgotten separately.

**Cross-tenant access is never implicit.** A SuperAdmin reaching another school
needs an unexpired, unrevoked row in `support_access_grants` issued to them
specifically, and the read writes an `audit_events` row naming the grant and its
reason. With no grant their queryset returns nothing, not everything. A view may
opt into every tenant only where the matrix marks a capability "✔ all".

**Parents are scoped by links, not by school.** `users_role_school_scope_check`
gives a Parent `school_id IS NULL`, so school filtering does not apply. Every
parent-facing query joins through `parent_student_links`, which is the only path
from a parent to a student.

These rules are duplicated in `frontend/lib/authorization.ts` on purpose: two
services read one database, and a rule enforced on only one side is not
enforced. Change one, change both.

## Deployment targets

| Service | Target | Why |
| --- | --- | --- |
| `frontend/` | Cloudflare Workers | Where it already runs. Unchanged. |
| `backend/` | A dedicated Python host | **Cloudflare Workers cannot run Django.** This is a hosting line item, not an assumption. |
| `supabase/` | Supabase managed Postgres | Already hosted; no data migration. |

Django settings are split `base` / `dev` / `test` / `prod`. `manage.py`
defaults to dev, `wsgi.py` and `asgi.py` default to prod, and no environment
is implicit. Every secret is read through `django-environ` with no fallback,
so a missing value fails at boot instead of running on a placeholder.

## Boundaries that must not be crossed

1. **No cross-imports.** `frontend/` never imports from `backend/`, and vice
   versa. The only contract between them is HTTP + JSON over `/api/v1/`.
2. **CORS is an allowlist.** The Django API accepts the known frontend
   origin(s) only, and it takes a bearer token rather than cookies
   (`CORS_ALLOW_CREDENTIALS = False`).
3. **Tenant isolation is enforced in the queryset layer**, via
   `apps.common.permissions.TenantScopedQuerySetMixin` — not by remembering to
   filter in each view. A view holding no tenant data opts out explicitly by
   setting `tenant_field = None`.
4. **Deny by default.** DRF's default permission is `IsAuthenticated`; public
   endpoints opt out.
5. **Logs carry metadata only.** Never a raw OpenAI prompt or response, never a
   payment payload — both can carry student PII.

## Known seams

Things that are correct today but will drift if edited carelessly:

- **The role enum is defined three times**: the SQL role constraint in
  `supabase/migrations/20260903000000_roles_and_school_status.sql`,
  `frontend/lib/roles.ts`, and `backend/apps/accounts/roles.py`. Changing one
  means changing all three. The values are PascalCase (`SuperAdmin`), not
  snake_case. `backend/apps/accounts/tests/test_role_parity.py` reconciles all
  three and fails if they drift.
- **The Node contract suite lives in `frontend/tests/`** but several of its
  files assert on SQL in `supabase/migrations` — they are repo-level contract
  tests that happen to be run by the frontend's toolchain. If the backend grows
  its own schema assertions, that suite is the place to reconcile them.
- **The existing 17 Next.js API routes are out of scope for the current phase.**
  Their authorisation coverage is uneven by design of the plan, not by
  oversight. See `docs/plan/04-DJANGO-HYBRID-PLAN.md`.
