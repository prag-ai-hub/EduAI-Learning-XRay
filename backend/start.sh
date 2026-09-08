#!/usr/bin/env bash
# Local development launcher. Production runs the systemd unit in deploy/.
set -euo pipefail
cd "$(dirname "$0")"

[ -d .venv ] || { echo "No .venv - run 'make install-backend' from the repo root."; exit 1; }

export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-eduai_backend.settings.dev}"
exec .venv/bin/python manage.py runserver "${1:-8000}"
