# Running and testing EduAI Learning X-Ray locally

Everything below runs on your machine against a local Supabase stack.
No remote project is touched at any point.

---

## One-time setup

Already done in this working tree, listed so it can be reproduced:

```bash
node -v                    # must be >= 22.13.0  (v22.23.2 is installed in ~/.local)
npm install
npx supabase init          # created supabase/config.toml
```

Docker must be running — the Supabase stack is 12 containers.

## Start

```bash
npx supabase start         # ~90s first time; seconds afterwards
npm run dev                # http://localhost:3000
```

`supabase start` applies every migration in `supabase/migrations/` automatically,
M1 through M6.

| Service | URL |
|---|---|
| App | http://localhost:3000 |
| Supabase Studio (browse tables, run SQL) | http://127.0.0.1:54323 |
| Mailpit (catches every outgoing email, e.g. invitations) | http://127.0.0.1:54324 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

## Environment

`.env` is generated for local use and is gitignored. The three Supabase values
come from `npx supabase status -o env`. Two are yours to fill in:

```
MISTRAL_API_KEY=      # OCR of scanned answer sheets and PDFs
OPENAI_API_KEY=       # grading, learning gaps, study guides, worksheets
```

**Restart `npm run dev` after editing `.env`** — secrets are read at startup.

---

## What you can test without any AI keys

Most of the product. All of this works against the local database:

- Sign up, email/password sign-in, first-login profile creation
- Workspace persistence — create data, reload the page, confirm it returns
  (writes to `workspace_snapshots`, debounced 700 ms; watch the topbar
  indicator go `Saving… → Cloud synced`)
- Offline behaviour — stop `npm run dev`, reload: the app falls back to the
  `localStorage` cache and shows `Offline · queued`
- Creating assessments with **uploaded** question papers
- File upload, document-role classification, preview, download, delete
  (files go to Supabase Storage; check the `eduai-files` bucket in Studio)
- Uploading `.txt` / `.md` / `.docx` / `.xlsx` evidence — these are parsed
  **locally**, so OCR text appears with no Mistral key
- Student roster CSV/XLSX import
- Admin: invite a user (the email lands in Mailpit), assign credits,
  enable/disable
- Credits ledger and balance
- Reports, heatmaps, performance matrix — empty until something is graded
- Parent QR share links and the public `/share/{token}` page
- System health panel (correctly reports both providers unconfigured)

## What needs keys

| Feature | Key |
|---|---|
| OCR of scanned/PDF answer sheets | `MISTRAL_API_KEY` |
| AI grading and learning-gap diagnosis | `OPENAI_API_KEY` |
| Generated assessments, study guides, worksheets | `OPENAI_API_KEY` |

Without them you get a clear error on those actions only; nothing else breaks.

> The four AI routes call model `gpt-5.6-sol`. That model id is not a published
> OpenAI model — verify it against your account before expecting grading to work,
> or the calls will fail with a model-not-found error regardless of the key.

---

## A useful manual pass

1. Open http://localhost:3000 — marketing page.
2. Go to http://localhost:3000/app — sign-up form.
3. Create an account. Local Supabase auto-confirms, so you land straight in.
4. Complete the profile form. **Check Studio → `public.users`: the `id` is a
   uuid matching `auth.users.id`.** That is M5 working.
5. Create an assessment, upload a question paper and a `.txt` answer sheet.
6. Give yourself credits — Studio → SQL:
   ```sql
   update public.users set total_credits = 10 where email = 'you@example.com';
   ```
   Reload; the topbar shows `Credits Remaining: 10`.
7. Run an analysis. With no OpenAI key it fails — **and charges nothing**.
   Confirm `public.credit_transactions` is still empty.
8. With a valid key, run it again and watch a `consumption` row appear.
   If the analysis fails mid-flight, a matching `refund` row appears beside it.

## Verifying the migrations specifically

```bash
./scripts/test-migrations-local.sh
```

Rebuilds the database at the M1–M4 state, seeds representative rows, then applies
M5 and M6 — which is the conversion that actually has to work. A fresh database
has no rows, so applying M5 to one proves only that the SQL parses. It also runs
a negative test: seeded with a non-UUID id, M5 must refuse to run and leave the
schema untouched.

To inspect a real database before pushing, run `supabase/checks/schema-state.sql`
in the Supabase SQL editor. It is read-only and reports which migrations are
applied and whether M5 would pass its preflight.

## Reset and stop

```bash
npx supabase db reset      # wipe data, re-apply every migration
npx supabase stop          # stop the stack (data is preserved)
npx supabase stop --no-backup   # stop and discard all local data
```

---

## Two bugs this local setup already caught

Both were invisible to the build and the test suite, and would have reached
production:

1. **`column reference "used_credits" is ambiguous`** — `consume_credit` returns
   a table whose column names shadow columns of `public.users`, so
   `set used_credits = used_credits + p_cost` was ambiguous. Inherited from M3,
   where it sat unreachable behind the `auth.uid()` failure.

2. **A charged credit was never refunded.** The `OPENAI_API_KEY` check used
   `return`, not `throw`, so it exited the `try` without reaching the `catch`
   that issues refunds. The teacher silently lost a credit for work that never
   ran. The check now precedes the charge.

Regression tests for both are in `tests/migration-contract.test.mjs`.
