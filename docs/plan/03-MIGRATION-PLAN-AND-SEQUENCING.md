# Day 1 · Task 3 — Database Migration Plan & Sequencing

Existing migrations M1–M4 are described in `docs/PROJECT_ANALYSIS.md` §6.
This document defines M5–M11 and the order they must be applied in.

---

## 1. Sequencing rule

**Identity before structure. Structure before data. Data before behaviour.**

M5 (identity) must land before any new table takes a foreign key on `users`, otherwise every
new table inherits the `text` vs `uuid` split that already broke `consume_credit`. The original
Day 2 plan created `parent_student_links` first; that ordering is inverted here.

```
M5  identity unification        ← blocks everything
M6  credit function repair      ← depends on M5
M7  roles + school status
M8  parent–student linking      ← depends on M5, M7
M9  plans + subscriptions
M10 payments + events + invoices ← depends on M9
M11 read-model publication      ← depends on M5, M8
```

---

## 2. M5 — `20260902000000_identity_uuid_unification.sql`

**The riskiest migration in the project. Apply to a restored production copy first.**

### Scope decision

`public.users.id` becomes `uuid`. **`public.schools.id` stays `text`.**

Rationale: user ids are already Supabase auth UUIDs (written from `authUser.id` in
`app/api/profile/route.ts`), so the cast is lossless. School ids are `school-{uuid}` strings
that are *not* valid UUIDs and are embedded in the JSON workspace blobs — converting them means
rewriting `workspace_snapshots.state_json` for every teacher. That risk buys nothing: the bug
we are fixing is `users.id` vs `auth.uid()`, and schools are never compared to `auth.uid()`.

### Columns changing to `uuid`

| Table | Column | FK |
|---|---|---|
| `users` | `id` | pk |
| `classes` | `teacher_id` | → users |
| `assessment_versions` | `authored_by`, `approved_by` | → users |
| `evaluation_drafts` | `evaluator_id` | → users |
| `evaluation_versions` | `evaluator_id` | → users |

`audit_events.actor_id` stays `text` — it has no FK and must be able to record non-user
actors (`system`, `webhook:razorpay`).

### Steps

1. **Preflight guard.** Abort with a clear message unless every value in every affected column
   is either NULL or a valid UUID. Non-negotiable — a silent partial cast is unrecoverable.
2. Drop the five dependent FK constraints.
3. `alter column … type uuid using <col>::uuid` on each.
4. Re-create the FKs and the `users` unique index on `(school_id, email)`.
5. Post-check: row counts match, and a sample join `users ⋈ auth.users` on id returns matches.

### Rollback

Reverse cast to `text` is lossless. Keep a `pg_dump` of the five tables taken immediately
before. Rollback window closes once M6+ have run.

### Application code touched

- `lib/authorization.ts` — `AuthorizedProfile.id` type
- `app/api/profile/route.ts` — `schoolId` still built as `school-${authUser.id}` (unchanged)
- `app/api/admin/users/route.ts`, `app/api/admin/invitations/route.ts` — no logic change
- `app/api/evaluations/submit/route.ts` — `evaluator_id: profile.id` now a uuid

---

## 3. M6 — `20260902000100_credit_function_repair.sql`

Fixes the blocker documented in `PROJECT_ANALYSIS.md` §11 B1. Two defects, both fatal:

1. `/api/grade` calls the RPC through the **service-role** client, so `auth.uid()` is NULL.
2. `where id = auth.uid()` compared `text` to `uuid` — no operator exists. (M5 fixes half.)

### New signatures

```sql
drop function if exists public.consume_credit(text, text, integer);
drop function if exists public.refund_credit(text, text);

create function public.consume_credit(
  p_user_id uuid, p_operation_key text, p_reference text default null, p_cost integer default 1
) returns table(total_credits int, used_credits int, remaining_credits int, charged boolean) …

create function public.refund_credit(
  p_user_id uuid, p_operation_key text, p_reason text default 'Analysis failed'
) returns void …
```

The caller now supplies the user id explicitly.

### Security consequence — must not be missed

Because the function trusts `p_user_id`, it becomes a privilege-escalation vector if any
end-user role can call it. Therefore:

```sql
revoke all on function public.consume_credit(uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.refund_credit(uuid,text,text)        from public, anon, authenticated;
grant execute on function public.consume_credit(uuid,text,text,integer) to service_role;
grant execute on function public.refund_credit(uuid,text,text)          to service_role;
```

M3 granted these to `authenticated`; that grant is revoked here. Only server routes holding the
secret key may call them — which is already the only call path in the codebase.

Behaviour otherwise preserved: `for update` row lock, idempotency on `operation_key`,
`Insufficient credits` on shortfall, disabled-account rejection.

### Application code touched

`app/api/grade/route.ts` passes `p_user_id: user.id` on both the consume and refund calls.
The `PGRST202` "migration not yet applied" fallback stays until M6 is confirmed in production.

---

## 4. M7 — `20260903000000_roles_and_school_status.sql`

- `users.role` check constraint → `('SuperAdmin','SchoolAdmin','Teacher','Parent')`,
  preceded by `update users set role='SchoolAdmin' where role='Admin'`.
- Role/scope invariant: `check ((role in ('SchoolAdmin','Teacher')) = (school_id is not null))`.
  Requires `users.school_id` to become **nullable** (it is `not null` today) so SuperAdmin and
  Parent rows can exist.
- `invitations.role` check widened to the same four values.
- `schools.status`.
- ~~`schools.plan_id`~~ — **deferred to M9.** It carries a foreign key to
  `public.plans`, which does not exist until M9, so the column is added there
  alongside its target. Recorded in M7's header comment.
- `support_access_grants` table for the SuperAdmin cross-tenant rule.
- Promote the seeded admin email from `SchoolAdmin` to `SuperAdmin`.

> `users.school_id` dropping `not null` is a real behaviour change. Every existing query that
> assumes a school must be audited — `getAuthorizedProfile` already returns `school_id|null`,
> and `/api/evaluations/submit` already 403s on a missing school, so exposure is small.
>
> **Consequence for the existing unique index.** `users` carries `unique (school_id, email)`.
> Postgres treats NULLs as distinct, so once `school_id` is nullable that constraint stops
> protecting SuperAdmin and Parent rows. M7 therefore adds a partial index:
> `create unique index users_email_no_school_idx on public.users (lower(email)) where school_id is null;`
> Supabase Auth already enforces unique emails upstream, so this is defence in depth rather
> than the primary guard — but without it the table would accept duplicates.

## 5. M8 — `20260903000100_parent_student_links.sql`

- `parent_student_links` — `parent_user_id uuid → auth.users`, `student_id text → students`,
  `school_id`, `relationship`, `status ('pending','active','revoked')`, `linked_via`,
  unique `(parent_user_id, student_id)`.
- `parent_invite_codes` — short code, `student_id`, `created_by`, `expires_at`, `max_uses`,
  `used_count`, `status`. Single-use and expiring by default.

## 6. M9 / M10 — plans, subscriptions, payments, events, invoices

Exactly as specified in `02-PAYMENT-DATA-MODEL.md`. M10 also:
- adds `credit_transactions.payment_id` and widens its `transaction_type` check with `purchase`
- creates the per-financial-year invoice number sequence

## 7. M11 — `20260905000000_read_model_publication.sql`

The migration the original plan did not have, and without which Days 8, 9, 12 and 13 cannot be
built. See §8 for why.

- `grade_results` gains `school_id`, `evaluation_version_id`, `published_at`
- `resources` gains `school_id`, `student_id`, `assessment_id`, `published_at`
- `students` gains `external_ref` and a unique `(school_id, class_id, roll_number)`
- Indexes for the two new read paths: parent-by-child, and SuperAdmin cross-school aggregate

---

## 8. The read-model problem (and student identity)

Today every report lives inside one teacher's `workspace_snapshots.state_json`. A parent has no
teacher workspace, and a SuperAdmin cannot aggregate across blobs. So:

**On evaluation submit and on report generation, we also publish normalized rows** to
`grade_results` and `resources`. The teacher's blob remains the working copy and authoritative
draft store — nothing existing breaks — while parents and admins read only published rows.

### The hidden cost: students are not real records

`GradeResult.studentName` is **free text guessed from a filename** by `guessStudentName()`. There
is no student id anywhere in the grading path. A parent portal needs a durable student record to
link to. Publication therefore has to resolve identity:

1. Teacher picks the student from the class roster during grading (new required field), **or**
2. `guessStudentName()` proposes and the teacher confirms against `public.students`, creating the
   row on first use.

Option 2 preserves the current fast path and is what Week 2 will implement. This is roughly
**4 of the 12 read-model hours** and is the single most under-estimated item in the original plan.

---

## 9. Reflowed schedule

Added work: identity 5h · credit repair 3h · read model 12h · server-side invoice PDF +2h ·
rate-limit backing store 1.5h = **23.5 hrs ≈ 2.8 days**. Plan moves 25 → **28 days**.

| New day | Was | Content | Hrs |
|---|---|---|---|
| 1 | 1 | Design: role matrix · payment model · migration plan | 8.5 |
| **2** | **new** | **M5 identity unification + M6 credit repair + regression** | 8.5 |
| 3 | 2 | M7 roles & school status · M8 parent links | 8.5 |
| 4 | 3 | M9 plans/subs · M10 payments/events/invoices · authorization.ts 4-tier | 8.5 |
| 5 | 4 | SuperAdmin cross-tenant logic · RLS review · gateway KYC submit | 8.5 |
| 6 | 5 | Regression checks (core, auth, credits) · sandbox keys | 8.5 |
| **7** | **new** | **M11 + student identity resolution** | 8.5 |
| **8** | **new** | **Read-model write path on submit + report generation** | 8.5 |
| 9–13 | 6–10 | Auth UX + B2B onboarding & Super Admin console | 42.5 |
| 14–18 | 11–15 | B2C parent accounts + payment core | 42.5 |
| 19–23 | 16–20 | Payment completion, webhooks, production-readiness | 42.5 |
| 24–28 | 21–25 | Testing, hardening, deployment, handover | 42.5 |

Two line items inside the shifted weeks change:
- Day 9 (was 6) auth wiring drops from 6.5 h to ~3.5 h — Supabase email/password and
  Google/Microsoft OAuth already work in `TeacherAuth`; the work is relocation plus role-aware
  redirect. The 3 h saved funds the invoice-PDF overrun.
- Day 19 (was 16) webhook handler reuses the `payment_events` idempotency pattern rather than
  inventing one.

### If 25 days is contractually fixed

Cuttable without touching the critical path, in order:
1. Super Admin revenue analytics dashboard UI (Day 20 T1, 2.5 h) → ship the CSV export only
2. Renewal reminder notifications (Day 18 T3, 2.5 h) → defer to post-launch
3. Registration/suspension notification emails (Day 10 T2, 2.5 h) → manual for pilot
4. Parent "unlink child" self-service → admin-only for pilot

That recovers ~9 hrs. The remaining ~14 hrs must come from the Day 24–25 buffer, which leaves
**no contingency for QA findings** — not advisable for a payments release.

---

## 10. Status — updated 2026-09-01

| Migration | State |
|---|---|
| M5 identity unification | written, applied locally, tested |
| M6 credit repair | written, applied locally, tested |
| M7 roles + school status | written, applied locally, tested |
| M8 parent–student linking | written, applied locally, tested |
| M9 plans + subscriptions | not started (Day 4) |
| M10 payments + events + invoices | not started (Day 4) |
| M11 read-model publication | not started (Day 7) |

None of these has been applied to a remote database.

Two defects were found by running the migrations against a real local Postgres
rather than by review, both documented in their commits: an ambiguous column
reference that made `consume_credit` uncallable, and an ordering error that made
parent invite-code redemption non-idempotent. Both are the kind of thing that
only surfaces on execution — worth remembering when M9/M10 land.

## 11. Pre-flight before M5

1. **Initialise git and commit the current tree.** 28 days of schema surgery with no version
   control is the largest avoidable risk in this project. Not yet done.
2. Take a full Supabase backup; confirm restore works.
3. Confirm which migrations are actually applied in production — M3 and M4 both carry
   "not yet in schema cache" fallbacks in the code, implying uncertainty.
4. Add the missing env vars to `.env.example`: `SUPABASE_PUBLISHABLE_KEY`, the three Razorpay
   secrets, `GST_SELLER_STATE_CODE`, `GST_RATE_BPS`.
