# Secrets and rotation policy

Every credential the product holds, where it lives, and how it is replaced.
Covers both services: the Next.js app in `frontend/` and the Django API in
`backend/`.

Two rules apply without exception:

1. **A secret never has a working default.** `backend/config/settings/base.py`
   reads each one through `django-environ` with no fallback, so a missing value
   fails at boot rather than running on a placeholder. The frontend fails the
   same way at first use.
2. **A secret is never committed.** `.gitignore` excludes `.env` and `.env.*`
   while keeping `.env.example`. The example files carry empty values and a
   comment saying where the real one comes from.

## Inventory

| Secret | Held in | Reaches | Rotate | Blast radius if leaked |
| --- | --- | --- | --- | --- |
| `SECRET_KEY` | `backend/.env` | Django only | 90 days | Signed values forgeable. The API is token-authenticated and stateless, so the practical impact is low, but rotate anyway. |
| `DB_PASSWORD` | `backend/.env` | Django only | 90 days, and on any staff departure | **Total.** Full read/write on the shared Postgres, bypassing every application check. |
| `SUPABASE_JWT_SECRET` | `backend/.env` | Django only | With the Supabase project's JWT secret | **Total authentication bypass.** Anyone holding it can mint a token for any user id. See the note below. |
| `SUPABASE_SECRET_KEY` (service role) | root `.env` | Next.js server routes | 90 days | Full database access, and it is also the HMAC key for parent share links — rotating it invalidates outstanding links. |
| `SUPABASE_PUBLISHABLE_KEY` (anon) | root `.env` | Served to the browser | On project rotation | Low: it is public by design and constrained by RLS. |
| `OPENAI_API_KEY` | `backend/.env` only | The Django AI proxy | 90 days | Billable spend against the account. Never returned in an API response. |
| `MISTRAL_API_KEY` | `backend/.env` only | The Django AI proxy | 90 days | Billable spend. |
| `PAYMENT_GATEWAY_KEY_SECRET` | `backend/.env` | Django only | 90 days, immediately on suspicion | Ability to move money. Test and live keys are separated by environment and never shipped to the browser. |
| `PAYMENT_GATEWAY_WEBHOOK_SECRET` | `backend/.env` | Django only | With the gateway key | Forged webhooks accepted as genuine, which drives subscription and payment state. |
| Google OAuth client secret | root `.env` | Local Supabase stack only | See incident below | Sign-in as any Google user against the local stack. In production this lives in the Supabase dashboard, not in a file. |
| `MAIL_PASSWORD` | `backend/.env` | Django only | 180 days | Outbound mail sent as the product. |

`SUPABASE_JWT_SECRET` is the highest-value secret in the system after
`DB_PASSWORD`: Django's entire authorisation chain begins with verifying a
token against it (`backend/apps/accounts/authentication.py`). Treat rotating it
as a coordinated change — Supabase reissues tokens, and every in-flight token
becomes invalid, so users are signed out.

### A note on naming

Environment variable names follow the house convention shared with the other
EduAI services: unprefixed Django core settings (`SECRET_KEY`, `DEBUG`,
`ALLOWED_HOSTS`), split database parts (`DB_HOST`, `DB_NAME`, `DB_USER`,
`DB_PASSWORD`, `DB_PORT`, `DB_SSLMODE`) rather than one `DATABASE_URL`, and
`MAIL_*` for SMTP. Django's own setting names are fixed - `EMAIL_HOST` and
friends - so `prod.py` maps `MAIL_SERVER` onto `EMAIL_HOST` and so on. One
operator should read the same keys across services.

## Rotating

The order matters. Rotating a shared secret in one service and not the other
takes the product down.

1. Issue the new value in the provider's console. Do not revoke the old one yet.
2. Update the environment on every host that holds it — `backend/.env` for the
   Django host, the platform's environment settings for the Cloudflare-hosted
   frontend, and the Supabase dashboard for anything it owns.
3. Restart or redeploy both services.
4. Verify: `GET /health` on the Django host, a sign-in on the frontend, and for
   gateway keys a sandbox payment.
5. Only then revoke the previous value.

For `SUPABASE_JWT_SECRET`, steps 2 and 3 must land in the same window on both
services, because a token signed with the new secret is rejected by a service
still holding the old one.

## On suspected compromise

Skip the staged rotation. Revoke first, restore service second — a leaked
`DB_PASSWORD` or gateway secret costs more per minute than an outage does.
Then: rotate, redeploy, and check `audit_events` and the gateway dashboard for
activity in the exposure window.

## Open incident

**A real Google OAuth client id and secret were committed to `.env.example` in
commit `a6d0b38`** and were redacted on 2026-09-03. Redaction does not remove
them from git history, so **the pair still needs rotating in the Google
console**. Until that is done, treat the local-stack Google sign-in as
compromised. This is the one item on this page that is outstanding rather than
routine.

## Where this is checked

- Day 8 runs a secrets audit across both services (`.env.example` and
  `.gitignore` review, no keys in source).
- Day 19 repeats it as part of the combined security pass, alongside a
  dependency scan and the webhook signature re-verification.
- `backend/config/settings/base.py` is the single place Django reads secrets;
  a new credential belongs there and in this table, not in a module that
  happens to need it.
