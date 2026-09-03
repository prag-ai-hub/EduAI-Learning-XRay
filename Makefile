# EduAI Learning X-Ray - monorepo tasks.
#
# This repo is polyglot (Node + Python), so orchestration lives in make rather
# than in either workspace's own package manager. Every target runs from the
# repo root; each one cds into the workspace it belongs to.

SHELL := /bin/bash
.DEFAULT_GOAL := help

FRONTEND := frontend
BACKEND  := backend
PY       := $(BACKEND)/.venv/bin/python
PIP      := $(BACKEND)/.venv/bin/pip

# The Supabase CLI ships as a devDependency of the frontend workspace, but the
# schema it manages (supabase/) is shared and lives at the repo root - so the
# binary is invoked by path, with the repo root as the working directory.
SUPABASE := $(FRONTEND)/node_modules/.bin/supabase

.PHONY: help install install-frontend install-backend dev-frontend dev-backend \
        test test-frontend test-backend lint lint-frontend lint-backend \
        check db-start db-stop db-status db-push db-reset db-test db-bootstrap \
        migrate clean

help: ## Show this help
	@echo "EduAI Learning X-Ray - available targets:"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------- setup
install: install-frontend install-backend ## Install both workspaces

install-frontend: ## npm install in frontend/
	cd $(FRONTEND) && npm install

install-backend: ## Create backend/.venv and install dev requirements
	python3 -m venv $(BACKEND)/.venv
	$(PIP) install --upgrade pip
	$(PIP) install -r $(BACKEND)/requirements/dev.txt

# ---------------------------------------------------------------- run
dev-frontend: ## Next.js dev server on :3000
	cd $(FRONTEND) && npm run dev

dev-backend: ## Django dev server on :8000
	cd $(BACKEND) && DJANGO_SETTINGS_MODULE=config.settings.dev .venv/bin/python manage.py runserver 8000

# ---------------------------------------------------------------- verify
test: test-frontend test-backend ## Run every test suite

test-frontend: ## Build and run the Node contract suite
	cd $(FRONTEND) && npm test

test-backend: ## Run the Django/pytest suite
	cd $(BACKEND) && .venv/bin/python -m pytest

lint: lint-frontend lint-backend ## Lint both workspaces

lint-frontend:
	cd $(FRONTEND) && npm run lint

lint-backend:
	cd $(BACKEND) && .venv/bin/ruff check . && .venv/bin/ruff format --check .

check: lint test ## Lint then test everything
	cd $(BACKEND) && DJANGO_SETTINGS_MODULE=config.settings.prod .venv/bin/python manage.py check --deploy

# ---------------------------------------------------------------- database
# supabase/ is shared: the Next.js app and the Django service read the same
# Postgres. SQL migrations there remain the schema source of truth.
db-start: ## Start the local Supabase stack
	$(SUPABASE) start

db-stop: ## Stop the local Supabase stack
	$(SUPABASE) stop

db-status: ## Print local stack URLs and keys
	$(SUPABASE) status

db-push: ## Apply supabase/migrations to the linked project
	$(SUPABASE) db push

db-reset: ## Rebuild the local database from supabase/migrations
	$(SUPABASE) db reset

db-test: ## Migration regression harness (needs the local stack running)
	./scripts/test-migration-regression.sh

db-bootstrap: ## Create the `django` schema for Django's own tables (once per DB)
	psql "$${PSQL_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" \
		-f $(BACKEND)/scripts/bootstrap_schema.sql

migrate: ## Apply Django migrations (backend-owned tables only)
	cd $(BACKEND) && DJANGO_SETTINGS_MODULE=config.settings.dev .venv/bin/python manage.py migrate

# ---------------------------------------------------------------- housekeeping
clean: ## Remove build output and caches from both workspaces
	rm -rf $(FRONTEND)/dist $(FRONTEND)/.next $(FRONTEND)/.vinext $(FRONTEND)/tsconfig.tsbuildinfo
	find $(BACKEND) -name __pycache__ -type d -prune -exec rm -rf {} +
	rm -rf $(BACKEND)/.pytest_cache $(BACKEND)/.ruff_cache
