# Working rules for this repository

Read [PROJECT_ARCHITECTURE_GUIDE.md](PROJECT_ARCHITECTURE_GUIDE.md) for the
layout and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the boundaries.
These are the rules that are easy to break by accident.

## Layout

* Backend apps live at `apps/<group>/<app>/`. A group is a package, not an app —
  only leaves go in `INSTALLED_APPS`.
* **Never change an app's `label`.** Models point at each other by label and
  `django_migrations` records it. Moving a directory keeps the label; set it
  explicitly if the path change would alter it.
* `tenants.schools` is the tenant root. Anything with a FK to `schools.School`
  loads after it.
* Frontend code goes in `app/src/features/<feature>/`. Cross-feature code goes
  in `app/src/shared/`. **`shared/` must never import from `features/`.**
* `app/src/server/` is server-only — imported by `src/app/api/**+api.ts` and
  nothing else. A client bundle must never reach it.
* Anything under `app/src/app/` becomes a route. Providers do not go there.

## Schema

* **Only `supabase/migrations` creates or alters an application table.** Every
  Django model for those tables is `managed = False`.
* Django's own bookkeeping tables live in a separate `django` Postgres schema.
* Changing a column means a new SQL migration first, then the model.

## Secrets

* Every credential lives in the backend `.env` and is read through
  `django-environ`. The client receives `EXPO_PUBLIC_*` values only, and those
  are public by definition — never put a secret behind that prefix.
* No provider SDK key exists in `app/` or `frontend/`. The client asks the
  backend; the backend holds the key.

## Dependencies

* Python: `backend/requirements.txt`, pinned. It is the only requirements file.
  `backend/tests/test_requirements.py` parses every import and fails the build
  if something is undeclared or unpinned.
* JavaScript: `app/package.json`.

## AI calls

* Backend: through `apps.platform.aiproxy.services` only. No direct OpenAI or
  Mistral SDK call anywhere else.
* Prompts are scrubbed by `apps.platform.aiproxy.scrubbing` before they leave.
  A scrubbing failure is a hard error, never a fallback to the raw prompt.

## Network calls from the client

* Every request goes through `authFetch` from
  `app/src/features/auth/api/authApi.ts`. It owns the bearer token and the 401
  refresh.
* **Never a relative URL.** `fetch("/api/…")` resolves on Expo web and resolves
  to nothing on a device. Use `apiUrl()`.

## Authorisation

* Authority does not flow downward. There is a capability matrix
  (`apps/accounts/capabilities.py`), not a rank ladder — a SchoolAdmin outranks
  a Teacher on the org chart and still cannot run grading.
* SuperAdmin has no implicit cross-tenant access. It needs an expiring
  `SupportAccessGrant`, and the read is audited.
* Every DRF view declares `permission_classes` explicitly.

## UI

* **The visual language is fixed.** Build new screens freely, but reuse the
  existing theme, colours, spacing, type scale and component classes from
  `app/src/shared/theme/`. Do not restyle what is already there.

## Tests

* `make check` runs lint and tests for every workspace.
* Backend tests run against the *configured* database inside a rolled-back
  transaction. Start it with `make db-start && make db-reset`. They skip rather
  than fail when nothing is listening, and refuse to run against a non-local
  host.

## The retiring frontend

`frontend/` is the Next.js web app being replaced by `app/`. Its API routes and
libraries have already moved. **Do not add anything to it.** Fix it only to keep
it building until its screens finish porting into `app/src/features/`.
