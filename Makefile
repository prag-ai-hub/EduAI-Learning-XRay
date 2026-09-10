# EduAI Learning X-Ray - monorepo tasks.
#
# This repo is polyglot (Node + Python), so orchestration lives in make rather
# than in either workspace's own package manager. Every target runs from the
# repo root; each one cds into the workspace it belongs to.

SHELL := /bin/bash
.DEFAULT_GOAL := help

FRONTEND := frontend
APP      := app
BACKEND  := backend
PY       := $(BACKEND)/.venv/bin/python
PIP      := $(BACKEND)/.venv/bin/pip

# The Supabase CLI lives beside the schema it manages, in supabase/package.json,
# and not in either client workspace. It used to be a devDependency of
# frontend/, which meant `make db-push` and `make db-reset` would have stopped
# working the day that directory was deleted - the schema tooling was hostage to
# the retiring web app. The binary is still invoked by path because the CLI
# expects the repo root as its working directory: config.toml and migrations/
# are looked up at ./supabase/.
SUPABASE := supabase/node_modules/.bin/supabase

.PHONY: help install install-frontend install-app install-backend \
        dev-frontend dev-app dev-web build-app dev-backend test test-frontend test-backend \
        lint lint-frontend lint-app lint-backend \
        check db-start db-stop db-status db-push db-reset db-test db-bootstrap \
        migrate clean db-push-dry

help: ## Show this help
	@echo "EduAI Learning X-Ray - available targets:"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------- setup
install: install-frontend install-app install-backend ## Install every workspace

install-frontend: ## npm install in frontend/
	cd $(FRONTEND) && npm install

install-app: ## npm install in app/
	cd $(APP) && npm install

install-backend: ## Create backend/.venv and install every dependency
	python3 -m venv $(BACKEND)/.venv
	$(PIP) install --upgrade pip
	$(PIP) install -r $(BACKEND)/requirements.txt

# ---------------------------------------------------------------- run
dev-frontend: ## Next.js dev server on :3000
	cd $(FRONTEND) && npm run dev

dev-app: ## Expo dev server - press w for web, or scan the QR with Expo Go
	cd $(APP) && npx expo start

dev-web: ## Expo on the web, at http://localhost:8081
	cd $(APP) && npx expo start --web

build-app: ## Export the app (web bundle + server API routes)
	cd $(APP) && npx expo export --platform web

dev-backend: ## Django dev server on :8000
	cd $(BACKEND) && DJANGO_SETTINGS_MODULE=eduai_backend.settings.dev .venv/bin/python manage.py runserver 8000

# ---------------------------------------------------------------- verify
test: test-frontend test-backend ## Run every test suite
	@echo "note: app/ has no test suite yet - typecheck it with 'make lint-app'"

test-frontend: ## Build and run the Node contract suite
	cd $(FRONTEND) && npm test

test-backend: ## Run the Django/pytest suite
	cd $(BACKEND) && .venv/bin/python -m pytest

lint: lint-frontend lint-app lint-backend ## Lint every workspace

lint-frontend:
	cd $(FRONTEND) && npm run lint

lint-app:
	cd $(APP) && npx tsc --noEmit

lint-backend:
	cd $(BACKEND) && .venv/bin/ruff check . && .venv/bin/ruff format --check .

check: lint test ## Lint then test everything
	cd $(BACKEND) && DJANGO_SETTINGS_MODULE=eduai_backend.settings.prod .venv/bin/python manage.py check --deploy

# ---------------------------------------------------------------- database
# supabase/ is shared: the Next.js app and the Django service read the same
# Postgres. SQL migrations there remain the schema source of truth.
# supabase/config.toml reads the Google OAuth pair via env(...) at start time,
# and that pair is declared in backend/.env - the one file that holds every
# credential. Only those variables are exported: sourcing the whole file would
# put the database password and the provider keys into the CLI's environment
# for no reason.
db-start: ## Start the local Supabase stack
	@set -a; \
	  [ -f $(BACKEND)/.env ] && . <(grep -E '^SUPABASE_AUTH_EXTERNAL_' $(BACKEND)/.env) || true; \
	  set +a; \
	  $(SUPABASE) start

db-stop: ## Stop the local Supabase stack
	$(SUPABASE) stop

db-status: ## Print local stack URLs and keys
	$(SUPABASE) status

# SUPABASE_DB_URL names the hosted project and lives in backend/.env, beside
# every other credential. Read here rather than exported globally, and only this
# target reads it - the DB_* block Django uses stays pointed at the local stack,
# because pointing it at production would break local development and
# conftest.py refuses to test against a non-local host anyway.
db-push: ## Apply supabase/migrations to the hosted project (SUPABASE_DB_URL in backend/.env)
	@set -a; 	  [ -f $(BACKEND)/.env ] && . <(grep -E '^SUPABASE_DB_URL=' $(BACKEND)/.env) || true; 	  set +a; 	  if [ -z "$$SUPABASE_DB_URL" ]; then 	    echo "SUPABASE_DB_URL is not set in $(BACKEND)/.env - see .env.example."; exit 1; 	  fi; 	  $(SUPABASE) db push --db-url "$$SUPABASE_DB_URL"

db-push-dry: ## Show what db-push would apply, without applying it
	@set -a; 	  [ -f $(BACKEND)/.env ] && . <(grep -E '^SUPABASE_DB_URL=' $(BACKEND)/.env) || true; 	  set +a; 	  $(SUPABASE) db push --db-url "$$SUPABASE_DB_URL" --dry-run

db-reset: ## Rebuild the local database from supabase/migrations
	$(SUPABASE) db reset

db-test: ## Migration regression harness (needs the local stack running)
	./scripts/test-migration-regression.sh

db-bootstrap: ## Create the `django` schema for Django's own tables (once per DB)
	psql "$${PSQL_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" \
		-f $(BACKEND)/scripts/bootstrap_schema.sql

migrate: ## Apply Django migrations (backend-owned tables only)
	cd $(BACKEND) && DJANGO_SETTINGS_MODULE=eduai_backend.settings.dev .venv/bin/python manage.py migrate

# ---------------------------------------------------------------- housekeeping
clean: ## Remove build output and caches from both workspaces
	rm -rf $(FRONTEND)/dist $(FRONTEND)/.next $(FRONTEND)/.vinext $(FRONTEND)/tsconfig.tsbuildinfo
	find $(BACKEND) -name __pycache__ -type d -prune -exec rm -rf {} +
	rm -rf $(BACKEND)/.pytest_cache $(BACKEND)/.ruff_cache
