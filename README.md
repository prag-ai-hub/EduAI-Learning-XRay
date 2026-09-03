# EduAI Learning X-Ray

A hybrid backend for a multi-role B2B/B2C education platform: AI-assisted
grading and learning-gap analysis for teachers, a parent portal, school
onboarding, and payments.

The repository holds **two deployable services and one shared database**. They
are kept in separate top-level directories on purpose — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the boundaries and why they
sit where they do.

```
.
├── frontend/     Next.js app on Cloudflare Workers  — the existing product surface
├── backend/      Django REST API on its own Python host — all new functionality
├── supabase/     Shared Postgres schema: SQL migrations + local stack config
├── scripts/      Database and release scripts that belong to neither service
├── docs/         Analysis, architecture, and the day-by-day delivery plan
└── Makefile      Every task, for both workspaces, from the repo root
```

Two rules keep the split honest:

1. **Neither service reaches into the other's directory.** They talk over HTTP.
2. **Only `supabase/migrations` changes the application schema.** Django gets
   its own Postgres schema for its own bookkeeping and never migrates a table
   the SQL migrations own.

## Prerequisites

- Node.js `>= 22.13.0` (see `frontend/.nvmrc`)
- Python `>= 3.10`
- Docker, for the local Supabase stack
- `psql`, for the migration harness

## Quick start

```bash
make install          # frontend npm install + backend venv and requirements
cp .env.example .env                  # frontend + local Supabase stack
cp backend/.env.example backend/.env  # Django service

make db-start         # local Supabase on :54321 (API) and :54322 (Postgres)
make db-reset         # build the schema from supabase/migrations
make db-bootstrap     # create the `django` schema, once per database

make dev-frontend     # http://localhost:3000
make dev-backend      # http://localhost:8000
```

Run `make help` for the full target list.

## Verifying

```bash
make check            # lint + both test suites + Django's --deploy check
make test-frontend    # build, then the Node contract suite
make test-backend     # the Django/pytest suite
make db-test          # migration regression harness (local stack must be up)
```

## Environment files

There are two, and they are deliberately not merged:

| File | Read by | Holds |
| --- | --- | --- |
| `.env` | `frontend/` and the Supabase CLI | Supabase URL and keys, OpenAI/Mistral keys, Google OAuth for the local stack |
| `backend/.env` | the Django service | `DB_*` connection parts, the Supabase **JWT secret**, the AI provider keys, payment gateway keys, `SECRET_KEY` |

`frontend/.env` is a symlink to the root `.env`, so the Vite/Cloudflare dev
server and the Supabase CLI read one file. On a platform without symlinks, copy
it instead. Both files are gitignored; `.env.example` in each place is the
committed template.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Service boundaries, request flow, schema ownership, deployment targets |
| [docs/PROJECT_ANALYSIS.md](docs/PROJECT_ANALYSIS.md) | Full end-to-end analysis of the existing product |
| [docs/plan/](docs/plan/) | Role matrix, payment data model, migration sequencing, and the current delivery plan |
| [docs/SECRETS-AND-ROTATION.md](docs/SECRETS-AND-ROTATION.md) | Every credential, who holds it, and how it is rotated |
| [docs/LOCAL-TESTING.md](docs/LOCAL-TESTING.md) | Running the stack locally |
| [docs/MANUAL-VERIFICATION.md](docs/MANUAL-VERIFICATION.md) | Manual QA checklist |
| [backend/README.md](backend/README.md) | Django layout, settings, and conventions |
