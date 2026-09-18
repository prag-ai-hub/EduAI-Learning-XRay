# Deployment

Two deployables: the Django service, and the Expo app. This page covers the
Django service first, then `app/`.

## The Django service

Cloudflare Workers cannot run Django, so this service needs a Python host of
its own. Everything here has been exercised against a real container reaching a
real Postgres — it is a checklist, not a sketch.

`frontend/` keeps deploying to Cloudflare exactly as it does today, until
`app/` replaces it.

## Build and run

```bash
docker build -t eduai-backend backend/
docker run -p 8000:8000 --env-file backend/.env eduai-backend
```

The image runs gunicorn as a non-root user, serves its own static files through
WhiteNoise, and needs nothing in front of it but a TLS-terminating load
balancer.

## Before the first deploy

**Create the `django` schema, once per database.** Django keeps its own
bookkeeping tables (`django_migrations`, `auth_*`, content types) apart from the
application tables that `supabase/migrations` owns:

```bash
psql "$PSQL_URL" -f backend/scripts/bootstrap_schema.sql
python manage.py migrate            # or: make migrate
python manage.py seed_plans         # nothing can be sold without a plan
                                    # amounts are placeholders until the owner
                                    # confirms them - see docs/PRICING.md
```

`migrate` is a no-op against `public` by design — every application model is
unmanaged. Confirm with `manage.py sqlmigrate accounts 0001`: every operation
reports `-- (no-op)`.

## Required configuration

Everything in `backend/.env.example`, with these mattering most in production:

| Variable | Notes |
| --- | --- |
| `SECRET_KEY` | Real and long. A placeholder fails the deploy check. |
| `ALLOWED_HOSTS` | Name the hosts. A wildcard fails the deploy check. |
| `CORS_ALLOWED_ORIGINS` | Name the frontend origin(s). Wildcard or empty fails the deploy check. |
| `DB_*` | Supabase session pooler, `DB_SSLMODE=require`. |
| `SUPABASE_JWT_SECRET` | Every request authenticates against it. Empty fails the deploy check. |
| `REDIS_URL` | **Set it.** Without a shared cache, throttle counters are per-process, so every rate limit is N times looser under N gunicorn workers. The limits themselves, and what each protects, are in `backend/apps/common/throttling.py`; `backend/tests/test_rate_limits.py` asserts that every published route has one. |
| `SECURE_SSL_REDIRECT` | Defaults on. Turn off only if the platform speaks plain HTTP to the container *and* terminates TLS itself. |

Before that, ask the host what it can actually serve:

```bash
make config-status          # or: manage.py config_status --strict
```

It reports each capability — sign-in, AI grading, OCR, payments, GST invoicing,
email, shared rate limits — as READY, DEGRADED or BLOCKED, and for anything
blocked prints what it stops and where the value comes from. It reports whether
a secret is present, never its value, so the output is safe to paste into a
ticket. `--strict` exits non-zero while anything non-optional is blocked, which
is what a release job wants.

Run the checks before shipping — they are errors, not warnings:

```bash
make check-deploy
# which is:
DJANGO_SETTINGS_MODULE=eduai_backend.settings.prod python manage.py check --deploy
```

Run it with the **production** environment loaded. `make check` deliberately
does not include it: against a developer's local `.env` it can only ever fail
on the values production alone has.

## Health

`GET /health` returns `{"status":"ok","database":"ok|unreachable"}` and is
deliberately exempt from the TLS redirect: the probe arrives from inside the
network over plain HTTP, and redirecting it makes a broken app look healthy
because `curl -f` treats a 301 as success. The container's own HEALTHCHECK
demands a literal 200 for the same reason.

Point the load balancer at `/health` and require 200.

## Sizing

`gunicorn.conf.py` defaults to `2 * cpu + 1` sync workers; override with
`WEB_CONCURRENCY`. The request timeout is 150s, deliberately longer than the AI
proxy's own 120s read budget, so a slow generation is ended by the proxy with a
usable error rather than by gunicorn killing the worker underneath it.

## Rollback

The image is stateless. Redeploy the previous tag. Nothing to undo in the
database: this service adds no application tables, and its own migrations live
in the separate `django` schema.

## Still outstanding

- The host itself. Any Python-capable platform works — Fly, Render, Railway,
  ECS, a VM with Docker. It is not provisioned yet.
- A staging environment with its own database and its own `.env`.
- `REDIS_URL` needs a real instance for throttling to mean anything.

---

# Deploying app/

One codebase, three targets: a web bundle with server routes, and native iOS and
Android builds. Configuration lives in `app/eas.json`, validated by
`npx eas-cli config` — an invalid profile is rejected there, not at build time.

## What you must do yourself, once

`eas.json` is written, but an EAS **project** belongs to an account and cannot be
created from here:

```bash
cd app && npx eas-cli login && npx eas-cli init
```

That writes `extra.eas.projectId` into `app/app.json` and sets `owner`. Until it
is run, every `eas` command stops with "EAS project not configured".

## Environment

`app/.env.example` has two halves and the split is load-bearing:

| Half | Reaches | Rule |
| --- | --- | --- |
| `EXPO_PUBLIC_*` | compiled into the bundle | never a secret — anyone with the APK reads it |
| everything else | the server runtime only | the twenty routes under `src/app/api/` |

Expo loads `.env` from the **project directory**, so it is `app/.env`, not the
repo-root one. `backend/tests/test_secrets_audit.py` fails the build if a
server-side name gains an `EXPO_PUBLIC_` prefix.

`SHARE_TOKEN_SECRET` must be set. It signs parent share links and no longer
falls back to the Supabase service-role key — that fallback put link-signing and
full database access behind one value.

## Web

```bash
cd app && npx expo export --platform web
```

`app.json` sets `"web": {"output": "server"}`, so the export is **not** a static
site: it produces a server bundle because `+api.ts` routes have to run
somewhere. Any Node host works; the server-side variables above must be present
in its environment.

## Native

```bash
cd app
npx eas-cli build --profile preview    --platform android   # internal APK
npx eas-cli build --profile production --platform all       # store builds
```

`production` uses `appVersionSource: "remote"` with `autoIncrement`, so EAS owns
the build number and two machines cannot mint the same one.

## Still outstanding for app/

- `eas init` under the owner's account — nothing below it can run first.
- No host chosen for the web server bundle.
- Store credentials (Apple team, Play service account) for `eas submit`.
- The product UI is still in `frontend/`; a build today ships the shell.
