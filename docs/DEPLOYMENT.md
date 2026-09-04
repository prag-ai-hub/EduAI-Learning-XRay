# Deploying the Django service

Cloudflare Workers cannot run Django, so this service needs a Python host of
its own. Everything here has been exercised against a real container reaching a
real Postgres — it is a checklist, not a sketch.

The frontend keeps deploying to Cloudflare exactly as it does today.

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
| `REDIS_URL` | **Set it.** Without a shared cache, throttle counters are per-process, so every rate limit is N times looser under N gunicorn workers. |
| `SECURE_SSL_REDIRECT` | Defaults on. Turn off only if the platform speaks plain HTTP to the container *and* terminates TLS itself. |

Run the checks before shipping — they are errors, not warnings:

```bash
DJANGO_SETTINGS_MODULE=config.settings.prod python manage.py check --deploy
```

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
