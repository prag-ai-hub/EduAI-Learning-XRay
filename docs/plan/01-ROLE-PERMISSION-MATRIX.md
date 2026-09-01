# Day 1 · Task 1 — Role & Permission Matrix

Scope: Super Admin / School Admin / Teacher / Parent.
Baseline: `docs/PROJECT_ANALYSIS.md`. Supersedes the ad-hoc role handling in
`lib/authorization.ts` and `app/api/profile/route.ts`.

---

## 1. Role definitions

| Role | Tenant scope | Created by | `school_id` |
|---|---|---|---|
| `SuperAdmin` | **Cross-tenant** (EduAI Hub staff) | Seeded / promoted by another SuperAdmin | `NULL` |
| `SchoolAdmin` | Exactly one school | School registration approval, or invited by SchoolAdmin | required |
| `Teacher` | Exactly one school | Invited by SchoolAdmin | required |
| `Parent` | **Zero schools directly** — access derives from linked children | Self sign-up + invite code | `NULL` |

### Migration of existing roles

| Current value | Becomes | Notes |
|---|---|---|
| `Teacher` | `Teacher` | unchanged |
| `Admin` | `SchoolAdmin` | the hardcoded `priyadarshini.adap@eduaihub` account becomes `SuperAdmin` |
| `Principal`, `School admin`, `Platform admin` | — | client-only strings in `DemoState`, never persisted. Principal UI is retired or folded into SchoolAdmin read-only views. |

`public.users.role` currently has **no** check constraint. Migration M7 adds:
`check (role in ('SuperAdmin','SchoolAdmin','Teacher','Parent'))`.

### Two invariants the schema must enforce

1. `SchoolAdmin` and `Teacher` **must** have `school_id`; `SuperAdmin` and `Parent` **must not**.
   Enforced as a table check constraint, not application logic.
2. A `Parent` has no rows in `classes`, is never a `teacher_id`, and never appears in
   `credit_transactions` as a consumer of analysis credits — parents buy credits only for
   their own children's report generation, tracked separately.

---

## 2. Permission matrix

`✔` full · `◐` scoped/limited (see notes) · `–` none

### Platform administration

| Capability | SuperAdmin | SchoolAdmin | Teacher | Parent |
|---|:--:|:--:|:--:|:--:|
| List all schools (cross-tenant directory) | ✔ | – | – | – |
| Approve / reject school registration | ✔ | – | – | – |
| Suspend / reactivate a school | ✔ | – | – | – |
| Create / edit / archive plans | ✔ | – | – | – |
| Cross-school revenue analytics & export | ✔ | – | – | – |
| Read any school's audit trail | ✔ | ◐ own school | – | – |
| Impersonate / support-access a school | ✔ ◐ | – | – | – |

◐ Support access is time-boxed, reason-required, and writes an `audit_events` row on every
cross-tenant read. See §4.

### School administration

| Capability | SuperAdmin | SchoolAdmin | Teacher | Parent |
|---|:--:|:--:|:--:|:--:|
| Edit school profile / branding | ◐ | ✔ | – | – |
| Invite Teacher / SchoolAdmin | ◐ | ✔ | – | – |
| Enable / disable a user in own school | ◐ | ✔ | – | – |
| Allocate analysis credits to teachers | ◐ | ✔ | – | – |
| Create classes, sections, subjects | ◐ | ✔ | ◐ own classes | – |
| Manage student roster / import | ◐ | ✔ | ◐ own classes | – |
| Manage academic years | ◐ | ✔ | – | – |
| View school-wide reports & matrix | ◐ | ✔ | ◐ own classes | – |
| Subscribe / upgrade / cancel plan | ◐ | ✔ | – | – |
| View school payment history & invoices | ◐ | ✔ | – | – |

### Teaching workflow

| Capability | SuperAdmin | SchoolAdmin | Teacher | Parent |
|---|:--:|:--:|:--:|:--:|
| Create / generate assessment | – | – | ✔ | – |
| Upload evidence, classify documents | – | – | ✔ | – |
| Run OCR, validate extracted text | – | – | ✔ | – |
| Run AI grading (consumes a credit) | – | – | ✔ | – |
| Submit an evaluation version | – | – | ✔ | – |
| Generate study guides / worksheets | – | – | ✔ | – |
| Plan interventions, record follow-up | – | – | ✔ | – |
| Invite a parent to a student | – | ✔ | ✔ | – |
| Delete an assessment | – | ◐ | ✔ own | – |

SuperAdmin and SchoolAdmin deliberately **cannot** grade or submit evaluations. Teacher
authority over marks is the product's core promise and must not be delegable upward.

### Student data & reports

| Capability | SuperAdmin | SchoolAdmin | Teacher | Parent |
|---|:--:|:--:|:--:|:--:|
| Read a student's learning-gap report | ◐ | ◐ own school | ◐ own classes | ◐ linked children |
| Read study guide / worksheet / answer key | ◐ | ◐ own school | ◐ own classes | ◐ linked children |
| Read raw answer-sheet file bytes | – | – | ✔ own uploads | – |
| Read validated OCR text | – | – | ✔ own uploads | – |
| Read AI rationale / confidence per question | – | – | ✔ | – |
| Aggregate concept mastery (identified) | ◐ | ✔ own school | ✔ own classes | ◐ own children only |
| Aggregate mastery (de-identified) | ✔ | ✔ | ✔ | – |

Deliberate restrictions:
- **Parents never see raw scans, OCR text, or AI rationale** — only teacher-approved output.
  This preserves the "teacher is the author of the mark" position.
- **SuperAdmin sees no identifiable student data by default.** Cross-school analytics are
  de-identified aggregates. Identifiable access requires an active support-access grant (§4).

### Payments

| Capability | SuperAdmin | SchoolAdmin | Teacher | Parent |
|---|:--:|:--:|:--:|:--:|
| Start B2B checkout (school subscription) | – | ✔ | – | – |
| Start B2C checkout (credit top-up) | – | – | – | ✔ |
| View own payment history | ✔ all | ✔ school | – | ✔ own |
| Download GST invoice | ✔ all | ✔ school | – | ✔ own |
| Issue refund | ✔ | – | – | – |
| Receive payment webhooks | *system only* | – | – | – |

### Parent portal

| Capability | Parent |
|---|:--:|
| Sign up / sign in with own account | ✔ |
| Redeem an invite code to link a child | ✔ |
| List linked children | ✔ |
| View a child's latest reports & interventions | ✔ |
| Download a child's report PDFs | ✔ |
| Buy credits / a parent plan | ✔ |
| Unlink themselves from a child | ✔ |
| See other children in the class | – |
| See teacher names, class averages, rankings | – |

---

## 3. Enforcement points

Three layers. All three must agree; the database is the backstop.

**Layer 1 — `lib/authorization.ts` (extended).** Today it returns a profile or a `Response`
and offers only `requireAdmin`. It gains:

```ts
type Role = "SuperAdmin" | "SchoolAdmin" | "Teacher" | "Parent";

getAuthorizedProfile(request)                  // existing, extended with the new roles
requireRole(profile, ...roles: Role[])         // replaces requireAdmin
requireSchoolScope(profile, schoolId)          // 403 unless same school, or SuperAdmin w/ grant
requireLinkedChild(profile, studentId)         // 403 unless an active parent_student_link
requireActiveSchool(profile)                   // 403 when school.status !== 'Active'
requireEntitlement(profile, feature)           // 402 when the subscription does not cover it
```

`requireAdmin` is kept as a thin alias during migration, then deleted.

**Layer 2 — route handlers.** Every route declares its requirement on the first line of the
handler. No route may query with a caller-supplied `school_id` that has not passed
`requireSchoolScope`.

**Layer 3 — database.** RLS stays enabled with service-role-only access (the current model —
all reads go through server routes holding the secret key). New tables follow the same rule.
Check constraints enforce the role/`school_id` invariants from §1.

---

## 4. Cross-tenant access (SuperAdmin)

SuperAdmin bypass is **never implicit**. Three rules:

1. Default SuperAdmin queries return de-identified aggregates. Student names, roll numbers and
   report bodies are excluded at the query layer, not filtered in the UI.
2. Identifiable access requires an active row in `support_access_grants`
   (school, reason, granted_by, expires_at ≤ 72 h). This table already has UI copy in the
   Platform admin surface; Week 1 gives it a schema.
3. Every cross-tenant read under a grant writes `audit_events` with
   `action = 'support.cross_tenant_read'`, the grant id, and the entity touched.

This satisfies Day 4 T2 and Day 22 T3 (tenant-isolation re-check) with something testable.

---

## 5. Status gating

Two independent gates, evaluated in this order, before any billable action:

| Gate | Source | Blocked when | Behaviour |
|---|---|---|---|
| Account | `users.status` / `disabled_at` | not `Active` | 403, existing behaviour |
| School | `schools.status` | `Pending` \| `Suspended` \| `Closed` | 403 for writes; reads stay open so a school can see its own history and pay to reactivate |
| Subscription | `subscriptions.status` | `expired`, or `past_due` past its grace window | **402**, with a checkout link. Reads and downloads stay open. |

Rationale: suspending a school must never destroy a teacher's access to work already done, and
must never hide the invoice they need to pay. Only *new billable work* stops.

---

## 6. Open items carried to Day 2

- Confirm whether a Parent may hold accounts across multiple schools simultaneously
  (design assumes **yes**; `parent_student_links` carries its own `school_id`).
- Confirm whether SchoolAdmin may also be a Teacher (design assumes **no** — a second account
  is required; revisit if schools object during pilot).
- Decide the fate of the Principal UI: retire, or re-map to a read-only SchoolAdmin variant.
