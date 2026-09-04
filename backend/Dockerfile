# EduAI Learning X-Ray - Django API.
#
# Cloudflare Workers cannot run Django, so this service needs a Python host of
# its own. The image is deliberately plain: a runtime, the dependencies, the
# code, gunicorn. Anything cleverer is harder to debug at 2am.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# libpq for psycopg. Build tools are not needed: psycopg[binary] ships wheels.
RUN apt-get update \
 && apt-get install --no-install-recommends -y libpq5 curl \
 && rm -rf /var/lib/apt/lists/*

# Dependencies first, so a code change does not reinstall them.
COPY requirements/ requirements/
RUN pip install -r requirements/prod.txt

COPY . .

# Static files for the browsable API and any admin surface. Runs at build time
# with throwaway settings: collectstatic must not need real credentials.
RUN SECRET_KEY=build-only-not-used-at-runtime \
    ALLOWED_HOSTS=localhost \
    CORS_ALLOWED_ORIGINS=http://localhost \
    CSRF_TRUSTED_ORIGINS=http://localhost \
    DB_NAME=x DB_USER=x DB_PASSWORD=x DB_HOST=localhost DB_PORT=5432 \
    SUPABASE_URL=http://localhost SUPABASE_JWT_SECRET=x \
    DJANGO_SETTINGS_MODULE=config.settings.prod \
    python manage.py collectstatic --noinput

# Never run as root: a container escape should not start with uid 0.
RUN useradd --system --uid 10001 --home /app eduai && chown -R eduai:eduai /app
USER eduai

EXPOSE 8000

# The load balancer reads this too; keeping it here means a broken image fails
# before it takes traffic.
# Demands a literal 200: `curl -f` alone treats a redirect as success, so a
# TLS redirect in front of a broken app would report healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/health)" = "200" ] || exit 1

CMD ["gunicorn", "-c", "gunicorn.conf.py", "config.wsgi:application"]
