# Secrets and rotation policy

Every credential the product holds, where it lives, and how it is replaced.
Covers both services: the Next.js app in `frontend/` and the Django API in
`backend/`.

Two rules apply without exception:

1. **A secret never has a working default.** `backend/eduai_backend/settings/base.py`
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
| Google OAuth client secret | `backend/.env` | Local Supabase stack, via `make db-start` | See incident below | Sign-in as any Google user against the local stack. In production this lives in the Supabase dashboard, not in a file. |
| `MAIL_PASSWORD` | `backend/.env` | Django only | 180 days | Outbound mail sent as the product. |

`SUPABASE_JWT_SECRET` is the highest-value secret in the system after
`DB_PASSWORD`: Django's entire authorisation chain begins with verifying a
token against it (`backend/apps/accounts/authentication.py`). Treat rotating it
as a coordinated change — Supabase reissues tokens, and every in-flight token
becomes invalid, so users are signed out.

### Where each secret lives, and why not everywhere

`backend/.env` is the single declaration for every credential the project uses,
including the Google OAuth pair that Django itself does not consume - the
Supabase CLI receives it from there at `make db-start`.

Two values remain outside it, deliberately:

**`SUPABASE_PUBLISHABLE_KEY`** is the anon key. It is public by design,
constrained by RLS, and has to reach a browser to work at all. Serving it from
Django would make sign-in depend on the Django service being up, which is an
availability cost for no security gain.

**`SUPABASE_SECRET_KEY`** is the service-role key, and it is the one real
outstanding item. `frontend/lib/supabase-server.ts` uses it for every database
call in thirteen routes, and `frontend/lib/share-tokens.ts` uses it as the HMAC
key for parent share links. Removing it means moving that data access into
Django - the migration this phase declares out of scope.

It should not be "fetched from the backend" instead. A secret retrieved at
runtime is weaker than one held in the environment: it turns a static config
value into a network dependency, and anything that compromises the frontend's
token to Django then yields the database as well. The way to remove a key from
a service is to move the work that needs it, not to move the key across a wire.

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

## Incident: Google OAuth pair

**Status: OPEN — awaiting rotation in the Google console.**

**A real Google OAuth client id and secret were committed to `.env.example` in
commit `a6d0b38`** and were redacted on 2026-09-03. The history rewrite landed,
so a fresh clone carries nothing — but the pre-rewrite blobs remain in existing
checkouts' object stores, unreachable from any ref and alive until a pruning
`gc`. On a forge, objects in that state stay fetchable by hash long after they
leave every branch. So **the pair still needs rotating**; until it is, treat the
local-stack Google sign-in as compromised.

Only the account owner can do this, in the Google console. When it is done,
change the status line above to `Status: ROTATED <date>`. That is the whole
edit — `test_lingering_objects_are_accounted_for` accepts either state and will
stay green, because once the credential is dead the lingering blobs are inert.
This is deliberately not a section to delete: the record of the incident is the
point, and deleting it is the one thing the test refuses.

## Where this is checked

- `backend/tests/test_secrets_audit.py` runs the whole audit on every test run.
  It is described below; it is the reason Day 8 and Day 19 are not two separate
  readings of the same two files.
- Day 19 repeats the combined security pass around it — dependency scan and
  webhook signature re-verification — but the secrets half is now continuous.
- `backend/eduai_backend/settings/base.py` is the single place Django reads secrets;
  a new credential belongs there and in this table, not in a module that
  happens to need it.

## The automated audit

`backend/tests/test_secrets_audit.py`, run by `make check` with everything else:

```
cd backend && .venv/bin/python -m pytest -q tests/test_secrets_audit.py
```

It fails the build on six exposures.

| # | Fails when | Why that shape |
| --- | --- | --- |
| 1 | A tracked `.env.example` carries a value | The templates are discovered by glob, not listed, so a new workspace is audited without anyone remembering to add it. A key named as a credential must be empty whatever its value looks like; every other key must match one of a handful of *public* shapes — boolean, port, URL without a userinfo section, host, email, dotted module path, short word. The allowlist is of shapes a credential cannot take, so a newly added key with a filled value fails by default rather than needing to be denied. |
| 2 | A `.env` is in the index, or a `.gitignore` rule does not match | Asks `git ls-files` and `git check-ignore`, never the text of `.gitignore`. The failure worth catching is a rule that exists and does not apply — an anchored `/.env` leaves `app/.env` open, and reading the file would show `.env` on a line and conclude all was well. It also checks the templates are *not* ignored, and that credential files with no `.env` in the name are. |
| 3 | A credential literal is in tracked source | Provider prefixes (`sk-`, `rzp_`, `GOCSPX-`, `AKIA`, `gh[pousr]_`, PEM headers, three-part JWTs, connection strings with an inline password), plus an entropy floor of 4.0 bits/char on any unbroken 20-character alphanumeric run that mixes letters and digits. Measured here: the densest identifier in tracked source scores 3.9, a random 22-character key scores 4.2. |
| 4 | The same, anywhere in reachable git history | Redaction does not unpublish. This is what says whether a history rewrite actually landed. |
| 5 | An `EXPO_PUBLIC_*` name promises a secret | `EXPO_PUBLIC_*` is compiled into the bundle and readable by anyone who downloads the APK. The name alone fails the build, filled in or not: by the time the variable exists, someone has decided a secret belongs on the client. The reference project shipped `EXPO_PUBLIC_GOOGLE_CLIENT_SECRET`; this check exists so that cannot repeat here. `PUBLISHABLE` and `ANON` are the only excused names, because that key is public by design and constrained by RLS. |
| 6 | The two templates disagree about where a credential lives | No provider key, database password or service-role key may be *named* in `app/.env.example`, prefixed or not. A key declared on both sides gets filled in on both sides, and then a rotation misses one. |

Two design decisions are worth keeping if this is ever rewritten.

**Nothing prints a value.** A failure gives the file, the line and the reason.
CI logs are usually readable by more people than the repository is, so a scanner
that echoes what it found leaks the secret a second time, more widely.

**Exclusions are properties of the value, never of the path.** A candidate is
excused only if it contains `example`, `placeholder`, `dummy`, `fake`,
`redacted`, `sample` or similar — editing a real key to contain one of those
breaks the key, which is the point. A path-based exclusion ("anything under
`tests/` is a fixture") is an open door: it can be satisfied by moving a live
credential into a test directory. The two structural exemptions are narrowed the
same way: subresource-integrity digests are stripped from the text rather than
the lockfile being skipped, and a character-set constant is recognised by being
*sorted* — an alphabet climbs at almost every step, a random key at about half —
because sorting a real key destroys it.

## Audit results — 2026-09-07

First run of the automated audit. 66 checks; the working tree and all reachable
history are clean. Verified beforehand that each check fails when its exposure is
present, against a throwaway repository built to contain each one — a green
check that would stay green is worse than no check.

**No filled-in credential in any template.** All three of `.env.example`,
`backend/.env.example` and `app/.env.example` carry empty values for every
credential. The non-empty values are hosts, ports, booleans, localhost URLs,
`DB_NAME`/`DB_USER=postgres`, module paths and model names.

**No credential literal in tracked source, and none reachable in git history.**
The `postgres:postgres@127.0.0.1:54322` string in the `Makefile`, the local
testing guide and the migration scripts is the local Supabase stack's own
documented default; the audit excuses it because the host is loopback *and* the
password is short and unrandom, so a production password typed against localhost
would still fail.

Three things came out of the run.

**Fixed — `.gitignore` did not cover credential files without `.env` in the
name.** `.envrc`, a Google service-account JSON, an SSH private key (`id_rsa`
and friends, which have no extension for `*.pem`/`*.key` to match) and `*.pfx`
were all unignored at every workspace root. Rules added, and check 2 now asserts
each of them matches, so a rule that stops applying is a failing test rather
than a silent regression.

**Outstanding — the Google OAuth pair still needs rotating.** See the open
incident above; this run did not change its status, and it cannot be closed from
here. What the run established is where the exposure now stands. Reachable
history is clean, so the rewrite recorded in the root `.env.example` did land: a
fresh clone carries nothing. But the pre-rewrite blobs are still in this
checkout's object store, unreachable from any ref and alive until a pruning
garbage collection, and on a forge such objects stay fetchable by hash long
after they leave every branch. So the wording in the root `.env.example` —
"scrubbed from git history" — is true of branches and misleading about
retrievability, and the credential should be treated as exposed until it is
replaced in the Google console. **That is a console action; nobody can do it
from the repository.**

The audit encodes exactly that. Check 4 fails hard on a *reachable* leak,
because that is what a clone hands out. An *unreachable* one is tolerated only
while this page still records an open incident — so the debris cannot be
quietly forgotten, and the test goes green the moment the rotation lands and
this section is rewritten to say so.

**Noted, not fixed — `app/.env.example` is not yet in the index.** The Expo
workspace is still uncommitted, so the file exists on disk and not in git. The
audit reads the working tree and covers it either way, and
`test_the_audit_is_not_vacuous` asserts it stays in scope. It needs adding with
the rest of `app/`.

### What it would have caught

The audit was written after the incident, so the honest test is whether it
catches it. Run against the object store it does: it reports a Google OAuth
client secret in two unreachable blobs, by prefix and independently by entropy.
Had it been in place on the day, the commit that put a working client id and
secret into `.env.example` would have failed check 1 on the value's shape and
check 3 on its prefix, before it was ever pushed.
