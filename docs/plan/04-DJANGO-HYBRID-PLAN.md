# 04 — Django Hybrid Plan (4 weeks / 170 hrs)

**Source:** `EduAI-Django-Hybrid-4Weeks.pdf`, supplied 2026-09-03.
**Supersedes:** the 25→28-day plan recorded in `03-MIGRATION-PLAN-AND-SEQUENCING.md` §9.
**Shape:** 1 developer · 8.5 hrs/day · 5 days/week · 20 working days · 170 hrs.

This is a compression of a 5-week/212.5-hr plan. Weeks 1–3 are unchanged from
that version; all ~42.5 hrs of the cut came out of Week 4.

## 1. What actually changed

The previous plan built everything inside the existing Next.js app on
Cloudflare Workers. This one introduces a **second service**.

| | Previous plan | This plan |
| --- | --- | --- |
| Home of new functionality | Next.js API routes on Cloudflare Workers | **New Django REST service on its own Python host** |
| Payment integration | Razorpay via REST + Web Crypto — the Node SDK cannot run on Workers | Server-side gateway **SDK** in Django; the Workers constraint is gone |
| Auth | Supabase Auth verified inside Next.js | Supabase Auth unchanged; a **DRF authentication class** verifies the same JWT |
| Schema changes | SQL migrations (`supabase/migrations`) | The plan says "Django migration" — see §3, this needs a decision |
| Existing 17 Next.js routes | Being hardened progressively | **Explicitly out of scope**, except one PII fix |
| Duration | 28 days | 20 days, "strictly held" |

Net effect on architecture is in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

### Effort by category (from the estimate)

| Category | Hrs | % |
| --- | ---: | ---: |
| Payment Gateway Integration | 37.5 | 22.1 |
| Testing & Deployment | 24.5 | 14.4 |
| Django Architecture & Data Modeling | 24.0 | 14.1 |
| Frontend Integration | 19.5 | 11.5 |
| Security & Environment Hardening | 16.0 | 9.4 |
| B2B Onboarding & Super Admin Console | 15.0 | 8.8 |
| Auth Bridge (Supabase JWT) & RBAC | 14.5 | 8.5 |
| B2C Parent Portal | 9.5 | 5.6 |
| OpenAI Security | 9.5 | 5.6 |
| **Total** | **170.0** | **100** |

## 2. The repo is ahead of this plan on Week 1

Most of Week 1's data modelling **already exists as SQL migrations**, built
under the previous plan and verified by `frontend/tests` and
`scripts/test-migration-regression.sh`.

| Plan item | Status in this repo |
| --- | --- |
| D1.2 `schools.status`, `schools.plan_id`, 4-tier roles | **Done.** `schools.status` in M7; `schools.plan_id` deferred to M9 beside `public.plans` |
| D1.3 / D2.3 parent-student linking + invite codes | **Done.** M8 — `parent_student_links`, `parent_invite_codes` |
| D2.1 widen role constraint (Super Admin + Parent) | **Done.** M7 |
| D2.2 plans / subscriptions / payments / invoices | **Done.** M9 (`plans`, `subscriptions`), M10 (`payments`, `payment_events`, `invoices`, `invoice_counters`) |
| D4.1 school-level tenant isolation | **Done for the Next.js surface.** M14 closed the RLS gap, M16 added the publish tenant guard |
| D5.1 regression check on the extended schema | **Done.** `scripts/test-migration-regression.sh` |
| D5.2 seed/fixture scripts | Partly — local stack seeds exist; no formal fixture set |

Not in the plan but already done, and a prerequisite the plan silently assumes:
**M5 migrated `public.users.id` from `text` to `uuid`** to match
`auth.users.id`. Django's JWT `sub` is a uuid and has to join to
`public.users.id`; without M5 the auth bridge could not resolve a user at all.

**So roughly 15–20 of Week 1's 42.5 hrs are already banked.** That is real
recovered budget against a schedule with only a 3-hr bug-fix buffer — but only
if §3 is decided the right way. Decided the wrong way, the same hours get spent
rebuilding what exists.

## 3. The decision this plan forces

> The plan says "Django migration: create plans / subscriptions / payments /
> invoices tables" (D2.2). Those tables **already exist**.

If Django runs `makemigrations` over them it produces a second, divergent
definition of tables it does not own, and `migrate` then tries to create tables
that are already there.

**Decision taken (reversible):** the SQL migrations in `supabase/migrations`
remain the single schema history. Django maps existing tables with
`managed = False` (start from `inspectdb`), and gets its own `django` Postgres
schema for framework bookkeeping only. `backend/scripts/bootstrap_schema.sql`
creates it; `search_path = django,public` keeps the two apart.

Reasons: the SQL migrations are already applied, already tested, and are the
only thing the Next.js app — which keeps running unchanged — can rely on. Two
migration systems writing one schema is the failure mode worth spending a
decision on.

The alternative, handing schema ownership to Django and faking an initial
migration, is defensible but means the Next.js app's schema contract is
maintained by a service it cannot see. Flip it only deliberately.

## 4. Confirmed finding this plan is right about

`frontend/app/api/grade/route.ts:73` builds the OpenAI prompt as
`Student: ${studentName}` — the real student name is sent to OpenAI on every
grading call. The plan's Day 9 hotfix is a genuine finding, still present.

Note the same value is also written into the credit-transaction reference at
line 56 (`p_reference`). That one stays inside the database rather than going
to OpenAI, so it is not the same leak, but it is the same PII travelling
further than it needs to and is worth deciding on at the same time.

## 4a. The approval workflow has a bypass, and it is not in Django

`PUT /api/profile` in the Next.js app — the profile-completion step every new
teacher goes through — creates a school with `status: "Active"`:

```ts
const { error: schoolError } = await db.from("schools").upsert({
  id: schoolId, name: schoolName, status: "Active", ...
});
```

That is the only other path that creates a school, and it grants exactly what
Day 6's workflow exists to withhold. Built as it stands, the gate is real for
anyone who uses `/register-school` and absent for anyone who signs up and fills
in their profile.

Closing it is a one-word change (`"Active"` → `"Pending"`), but it is a product
decision, not a cleanup: every self-signup would then land in a Pending school
and be blocked from writes until a Super Admin approves it. Someone has to want
that. It is also inside the Next.js surface this phase declares out of scope, so
it has been left alone and raised rather than changed quietly.

Three ways forward, in the order I would suggest them:

1. **Close it.** Self-signup creates a Pending school too. Coherent, and the
   approval queue becomes the single front door.
2. **Split the paths.** Self-signup keeps creating an Active *personal* school
   for an individual teacher; `/register-school` is the institutional path that
   needs review. Needs a way to tell the two apart.
3. **Leave it.** Only acceptable if approval is meant as a formality rather than
   a control — in which case the matrix's status gating should say so.

## 5. Day-by-day

Status: ▢ not started · ◐ partly covered by existing work · ✔ done

### Week 1 — Django foundation, data model, RBAC (42.5 hrs)

| Day | Task | Hrs | Status |
| --- | --- | ---: | --- |
| 1.1 | Django project setup: DRF, settings split, django-environ, connect to Supabase Postgres | 3.0 | ✔ **Done.** Live connection verified against the Supabase Postgres; `search_path = django,public` |
| 1.2 | Extend data model: `schools.status`, `schools.plan_id`, 4-tier roles; design payment schema | 3.0 | ✔ **Done.** M7 + M9 in SQL; `schools.School`, `billing.Plan` map them |
| 1.3 | Parent-student linking + invite-code model | 2.5 | ✔ **Done.** M8 in SQL; `parents.ParentStudentLink` / `ParentInviteCode` map them |
| 2.1 | Migration: widen role constraint | 3.0 | ✔ **Done.** M7; `accounts.roles` now pinned to the constraint by a parity test |
| 2.2 | Migration: plans / subscriptions / payments / invoices | 3.0 | ✔ **Adopted, not recreated** — M9 + M10, mapped unmanaged. See §3 |
| 2.3 | Migration: parent links + invite codes | 2.5 | ✔ **Done.** M8, mapped unmanaged |
| 3.1 | Supabase-JWT verification: DRF authentication class | 4.0 | ✔ **Done.** Signature/expiry/audience verified, then role, school and status resolved from `public.users` |
| 3.2 | DRF permission classes for the 4-tier hierarchy | 3.0 | ✔ **Done.** Capability matrix transcribed from `01-ROLE-PERMISSION-MATRIX.md`, deny-by-default |
| 3.3 | Serializer/viewset scaffolding + API versioning | 1.5 | ✔ **Done.** `/api/v1/` namespace, tenant-scoped and platform viewset bases, strict serializers |
| 4.1 | Tenant isolation via queryset filtering | 3.0 | ✔ **Done.** `TenantScopedQuerySetMixin` in the viewset bases; parents scope through links, not school |
| 4.2 | Super Admin cross-tenant access | 2.5 | ✔ **Done.** Support-access grants required, expiry enforced, every cross-tenant read audited |
| 4.3 | Env & secrets management, rotation policy | 3.0 | ✔ **Done.** `docs/SECRETS-AND-ROTATION.md` - inventory, order of operations, compromise path |
| 5.1 | Regression check: existing sessions against the extended schema | 2.5 | ✔ |
| 5.2 | Seed/fixture scripts | 3.0 | ✔ **Done.** `manage.py seed_plans` - idempotent catalogue, placeholder pricing pending Day 15.3 |
| 5.3 | Payment gateway account setup, sandbox keys, KYC | 3.0 | ◐ env plumbing and rotation policy done; the account, KYC and real sandbox keys are the client's to provide |

### Week 2 — B2B onboarding, security hardening (42.5 hrs)

| Day | Task | Hrs | Status |
| --- | --- | ---: | --- |
| 6.1 | 'Register your school' API + pending→approved workflow | 3.5 | ✔ **Done.** Identity-only auth, always Pending, fully audited — but see §4a |
| 6.2 | Super Admin approve / reject / suspend endpoints | 3.0 | ✔ **Done.** Validated state machine, reason required, every transition audited |
| 6.3 | Rate limiting & throttling (DRF throttle classes) | 2.0 | ✔ **Done.** Applied per view and tested; production needs `REDIS_URL` (see below) |
| 7.1 | Cross-school directory API (list / filter / search) | 3.0 | ▢ |
| 7.2 | Security headers & CORS hardening | 2.5 | ◐ `prod.py` headers + CORS allowlist in place |
| 7.3 | Registration / suspension notification emails | 3.0 | ▢ |
| 8.1 | Secrets audit: `.env.example` + `.gitignore` review | 2.0 | ◐ both rewritten for the split; audit not run |
| 8.2 | Input validation & serializer-level sanitization | 3.0 | ▢ |
| 8.3 | Audit logging for admin actions | 3.5 | ▢ `apps/audit` scaffolded only |
| 9.1 | School Admin subscription/plan status API | 2.5 | ▢ |
| 9.2 | QA: RBAC + JWT auth across all 4 roles | 4.0 | ▢ |
| 9.3 | **PII hotfix in `grade/route.ts`** | 2.0 | ▢ — see §4 |
| 10.1–10.3 | Frontend: Super Admin console, school registration form, API client with JWT | 8.5 | ✔ **Pulled forward and done** alongside Days 5–6, so the feature ships end to end |

### Week 3 — B2C parent portal, payment core (42.5 hrs)

| Day | Task | Hrs | Status |
| --- | --- | ---: | --- |
| 11.1 | Payment gateway SDK integration (server-side) | 4.0 | ▢ |
| 11.2 | Parent role support; JWT resolves Parent correctly | 2.0 | ▢ |
| 11.3 | 'Link a child' via invite code — API | 2.5 | ▢ (schema exists: M8) |
| 12.1 | B2B checkout: subscribe/upgrade API | 4.0 | ▢ |
| 12.2 | Frontend: parent sign-up/sign-in + link-a-child UI | 2.0 | ▢ |
| 12.3 | Parent dashboard: linked-children API | 2.5 | ▢ |
| 13.1 | Subscribe/upgrade logic + plan-change handling | 4.0 | ▢ |
| 13.2 | Teacher-side 'Invite parent' API | 2.0 | ▢ |
| 13.3 | Parent dashboard: reports/interventions API | 2.5 | ▢ (read model exists: M11) |
| 14.1–14.2 | Frontend: B2B checkout UI, parent dashboard UI | 6.0 | ▢ |
| 14.3 | B2C credit top-up logic | 2.5 | ▢ |
| 15.1 | New OpenAI proxy endpoint (server-side key isolation) | 3.0 | ▢ `apps/aiproxy` scaffolded only |
| 15.2 | PII scrubbing / anonymization layer for the proxy | 3.0 | ▢ |
| 15.3 | Plans & pricing schema finalization | 2.5 | ◐ M9 shape exists; pricing not finalized |

### Week 4 — Payment completion, testing, deployment (42.5 hrs)

| Day | Task | Hrs | Status |
| --- | --- | ---: | --- |
| 16.1 | Webhook handler: success/failure + signature verification | 4.0 | ▢ |
| 16.2 | Webhook: renewal/cancellation + idempotency | 3.0 | ◐ DB-side idempotency exists (M10 `payment_events`, M15 refund reopens the operation key) |
| 16.3 | Rate-limit testing & threshold tuning | 1.5 | ▢ |
| 17.1 | Payment receipts + history APIs | 3.0 | ▢ |
| 17.2 | GST-ready PDF invoice generation + compliance fields | 3.5 | ◐ `invoices` + `invoice_counters` exist (M10); no PDF generation |
| 17.3 | Failed-payment retry / grace period | 2.0 | ▢ |
| 18.1 | Frontend: receipts/history UI + top-up wiring | 3.0 | ▢ |
| 18.2 | Automated tests: RBAC, JWT, tenant isolation, webhook idempotency | 4.0 | ◐ 22 backend + 163 frontend tests green; none cover webhooks |
| 18.3 | OpenAI key-exposure & PII-scrub regression check | 1.5 | ▢ |
| 19.1 | End-to-end QA, all 4 roles, combined pass | 3.5 | ▢ |
| 19.2 | Security pass: webhook signatures, secrets audit, dependency scan, tenant re-check | 3.0 | ▢ |
| 19.3 | Payment QA: webhook retries, idempotency, sandbox edge cases | 2.0 | ▢ |
| 20.1 | Staging + production deployment | 3.0 | ▢ |
| 20.2 | Bug-fix buffer + go-live checklist | 3.0 | ▢ |
| 20.3 | Documentation handover | 2.5 | ◐ architecture + backend docs written |

## 5a. Days 1-2 — delivered 2026-09-03

Under the §3 decision, "create the tables" became "adopt them". What was built:

**Django's data layer over the existing schema.** 15 unmanaged models across
five apps, derived with `inspectdb` from the live database rather than
transcribed: `accounts` (User, Invitation), `schools` (School, SchoolClass,
Student, SupportAccessGrant), `billing` (Plan, Subscription, Payment,
PaymentEvent, Invoice, InvoiceCounter), `parents` (ParentInviteCode,
ParentStudentLink), `audit` (AuditEvent). Every enumerated column is a
`TextChoices` mirroring its CHECK constraint.

**Proof the adoption is safe, not just intended:**

| Check | Result |
| --- | --- |
| `manage.py migrate` against the shared database | `public` fingerprint byte-identical before and after |
| `sqlmigrate` for all five app migrations | every operation `-- (no-op)` — no CREATE, no ALTER |
| Tables created in `public` by Django | zero; its 8 bookkeeping tables are in `django` |
| `manage.py verify_mapping` | 15 models, 184 fields, all match the live schema |
| ORM round-trip (school → plan → subscription → payment → invoice → invite code → parent link) | writes accepted by every constraint, cross-app joins resolve, rolled back |

**New guards** (87 backend tests, up from 22):

- `tests/test_schema_ownership.py` — every model unmanaged, every migration
  DDL-free, `django` leads the search path. This is the §3 decision enforced.
- `tests/test_choice_parity.py` — all 17 enumerated columns matched against
  the CHECK constraints parsed out of `supabase/migrations`. Runs without a
  database, so CI catches drift on a clean checkout.
- `apps/accounts/tests/test_role_parity.py` — the role enum reconciled across
  all three places it is defined.
- `apps/common/management/commands/verify_mapping.py` — model-to-database
  check for the deploy pipeline; verified to catch both a renamed column and a
  changed type.

**Two defects found and fixed:**

1. The scaffold's `roles.py` used snake_case (`super_admin`). The database and
   `frontend/lib/roles.ts` both use PascalCase (`SuperAdmin`). Every role check
   in the backend would have silently never matched. The parity test now makes
   that impossible to reintroduce.
2. The auth bridge passed the JWT's role claim through unexamined. It now
   normalises: the pre-M7 `Admin` value maps to `SchoolAdmin`, and anything
   unrecognised becomes `None` rather than a working role.

**Finding that changes later days.** `public.users.id` has a foreign key to
`auth.users.id` (M13, ON DELETE CASCADE), so **Django cannot create a user**.
School registration (Day 6) and parent sign-up (Day 11) must create the
identity through Supabase Auth first and only then write the profile row. Any
plan for those days that assumes a plain `POST /users` is wrong.
`apps/accounts/tests/test_identity_ownership.py` fails if that FK is dropped.

## 5b. Days 3-4 — delivered 2026-09-03

**The token proves identity; the database decides authority.** The auth bridge
now verifies signature, expiry and audience and then loads role, school and
account status from `public.users`. A Supabase token's `app_metadata.role` goes
stale the moment a role changes or an account is disabled, and a token already
in a browser tab keeps asserting the old value. `frontend/lib/authorization.ts`
already read the database; the two services now agree.

**RBAC is a capability matrix, not a rank ladder.** The scaffold's
`IsTeacherOrAbove` was wrong: it would have let a SchoolAdmin grade, which the
role matrix forbids in terms - "teacher authority over marks is the product's
core promise and must not be delegable upward". Authority here does not flow
downward, so `apps/accounts/capabilities.py` transcribes the matrix directly and
the rank helpers were deleted so they cannot be reached for again. Permission is
deny-by-default: a view that declares no capability is refused, not served.

**A SuperAdmin has no implicit cross-tenant access.** `apps/common/tenancy.py`
mirrors the frontend: same checks, same order, same messages. Reaching another
school needs an unexpired, unrevoked `support_access_grants` row belonging to
that specific admin, and the read writes an `audit_events` row recording the
grant and reason - never the data reached. Without a grant a SuperAdmin's
queryset returns nothing, not everything; a view may opt into every tenant only
where the matrix says "✔ all".

**A parent is scoped by links, not by school.** Parents have `school_id IS NULL`
by database constraint, so school filtering does not apply to them. A view must
declare how to follow `parent_student_links`; until it does, a parent sees
nothing rather than something accidental.

**Testing.** 149 backend tests, up from 87. Database-backed tests run against
the configured database inside a rolled-back transaction, because the
application tables are unmanaged and a freshly created test database would hold
only Django's own bookkeeping. Two guards make that safe: a non-local
`DATABASE_URL` aborts the run, and an unreachable database skips the 37 database
tests instead of failing them, so the structural suite still runs on a clean
checkout.

**What the database taught us.** `support_access_grants` has
`CHECK (expires_at > created_at)`, so a grant cannot be created already expired
- the test for expiry has to backdate one. Worth knowing before writing the
Day 6 admin console.

**Not yet built:** no endpoints exist. Days 3-4 deliver the enforcement layer;
Day 6 onwards mounts routes on it.

## 5c. Days 5-6 — delivered 2026-09-03, with the Day 10 frontend

**Backend.** `manage.py seed_plans` seeds an idempotent five-plan catalogue
(nothing could be sold before — `public.plans` was empty). School registration
authenticates on Supabase identity alone, because the caller has just signed up
and has no profile row yet; it creates the school *and* their SchoolAdmin
profile in one transaction, always Pending. The lifecycle is a validated state
machine — Pending→Active, Pending→Closed, Active→Suspended,
Suspended→Active — with a written reason required for everything except
approval, and an audit row on every transition. `status` is read-only on the
serializer, so there is no PATCH into a state nobody chose.

**Frontend, pulled forward from Day 10** so the feature ships end to end:
`frontend/lib/django-api.ts` (attaches the Supabase token, unwraps Django's
error envelope, refuses to guess a base URL), `/register-school` (a form that
becomes a waiting room once submitted), and the cross-school directory with
approve/reject/suspend — added to the platform admin surface's existing
"Schools" module, which until now rendered placeholder buttons.

**The visual language was not touched.** All three stylesheets are byte-identical
to `HEAD`, and the 27 classes the new screens use were already defined.
`frontend/tests/school-onboarding.test.mjs` asserts that as a standing rule, so a
later screen cannot quietly add CSS.

**Throttling** is applied per view and tested — including that one noisy caller
cannot lock others out, and that `/health` is never throttled. One production
note: Django's default cache is per-process, so under N gunicorn workers every
limit is silently N times looser. `prod.py` uses `REDIS_URL` when set; without
it the limits are advisory.

**Testing.** 191 backend (up from 149) and 176 frontend (up from 163).

**Not done:** the payment gateway account, KYC and real sandbox keys (5.3) need
the client — only the env plumbing and rotation policy are in place.

## 6. Risks carried by the compression

Stated in the estimate itself, repeated here so they stay visible:

1. **Cut, not deferred cheaply:** the Super Admin revenue-analytics dashboard
   and renewal-reminder notifications are not in this phase.
2. **QA thinned:** per-role end-to-end passes (~8 hrs) became one combined pass
   (3.5 hrs); the security pass went 6 → 3 hrs.
3. **Buffer thinned:** the bug-fix buffer went 8 → 3 hrs. There is very little
   room to absorb anything found after Day 18.
4. **Deployment thinned:** staging and production went from ~7 hrs of separate
   steps to 3 hrs combined — for a service that has never been deployed before,
   on a host that does not exist yet.
5. **Out of scope and known:** the authorisation inconsistency across the 17
   existing Next.js routes. Recommended as Phase 2.

Items 3 and 4 compound: the first-ever deployment of a new service is exactly
where a thin buffer hurts. Worth raising with the client as a pair, not
separately.

## 7. Additional risks not in the estimate

1. **§3 is unpriced.** The plan budgets ~8.5 hrs (D2.1–D2.3) for migrations
   that already exist. Adopting them costs far less; rebuilding them in Django
   costs more than the estimate and risks schema divergence.
2. **Hosting is a line item with no hours.** "Cloudflare Workers cannot run
   Django" appears in the notes, but standing up a Python host, its TLS, its
   env separation and its deploy path is inside Day 20's 3 hrs.
3. **Two origins means two CORS/auth surfaces.** The frontend now calls its own
   `/api/*` and Django's `/api/v1/*` with the same token. Any inconsistency in
   how the two verify that token is a security gap that neither service's tests
   will catch alone.
4. **A live credential is already in git history.** `.env.example` carried a real
   Google OAuth client ID and secret from commit `a6d0b38` until they were
   redacted on 2026-09-03. Redaction does not remove them from history — the
   pair needs rotating in the Google console. This is Day 8's "secrets audit"
   arriving early, and it is a finding, not a hypothetical.
