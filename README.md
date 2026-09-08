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
├── app/          Expo app — web, iOS and Android from one codebase
├── backend/      Django REST API on its own Python host — serves every client
├── frontend/     Next.js web app — RETIRING, replaced by app/
├── supabase/     Shared Postgres schema: SQL migrations + local stack config
├── scripts/      Database and release scripts that belong to no single service
├── docs/         Analysis, architecture, and the day-by-day delivery plan
└── Makefile      Every task, for every workspace, from the repo root
```

Start with [CLAUDE.md](CLAUDE.md) for the working rules and
[PROJECT_ARCHITECTURE_GUIDE.md](PROJECT_ARCHITECTURE_GUIDE.md) for the
folder-by-folder map.

Three rules keep the split honest:

1. **No client reaches into another's directory.** They talk to `backend/` over
   HTTP. Code both clients need lives in `app/src/shared/`.
2. **Only `supabase/migrations` changes the application schema.** Django gets
   its own Postgres schema for its own bookkeeping and never migrates a table
   the SQL migrations own.
3. **`app/src/shared/` has no platform-specific APIs and never imports a
   feature.** It is bundled by a Cloudflare Worker, a browser and Metro;
   anything that works in only one of those belongs in a feature slice.

`frontend/` is being folded into `app/` and will be deleted. Its 20 server API
routes are already ported — Expo Router serves them as `+api.ts` files, and they
moved almost verbatim because they were written against the Web Fetch
`Request`/`Response` API rather than anything Next-specific. What remains is the
UI, which has to become React Native components so the same screens render on
web and on a phone.

Until that finishes, `frontend/` stays runnable and imports its API client from
`app/src/shared/api` rather than keeping a copy.

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
make dev-web          # Expo on the web (npx expo start --web)
make dev-app          # Expo dev server; scan the QR with Expo Go
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
| `.env` | `frontend/` and the Supabase CLI | Supabase URL, the service-role key and the public anon key |
| `backend/.env` | the Django service | Every other credential: `DB_*`, Supabase **JWT secret**, AI provider keys, payment gateway keys, SMTP, Google OAuth, `SECRET_KEY` |

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
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Building, configuring and shipping the Django service |
| [backend/README.md](backend/README.md) | Django layout, settings, and conventions |
