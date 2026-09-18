# Roles: who can be what, and how they get there

## `createsuperuser` does not make a Super Admin

Both exist, and they are different things.

`manage.py createsuperuser` writes a row in `auth_user`, Django's own table, and
that account signs into the **back office** at `/admin/` — a support tool that
edits rows directly. It is not the product's Super Admin, holds no capability in
the matrix, and cannot sign into the product's own screens at all.

The product's **Super Admin** is a role on a Supabase identity
(`public.users.role`), and it is what the app, the API and the capability matrix
mean by the word.

Three separate things are easy to confuse:

| | Where it lives | What it decides |
| --- | --- | --- |
| **Identity** | Supabase Auth (`auth.users`) | Who you are. Email, password, Google. |
| **Profile** | `public.users` | Your name, school, credits — and `role`. |
| **Authority** | `apps/accounts/capabilities.py` | What that role may do. |

Django verifies the Supabase token on every request and then reads the role
**from the database**, never from the token: a role change takes effect on the
next request, and a stale token cannot carry an old role back.

## Two different admins, and they are not the same thing

| | The back office (`/admin/`) | The product's Super Admin |
| --- | --- | --- |
| Login | a **Django** account, `manage.py createsuperuser` | a Supabase account with `role = 'SuperAdmin'` |
| Reaches | rows, directly | the product's own screens and API |
| Gated by | Django's `is_staff` + model permissions | the capability matrix, plus support grants |
| For | support and operations: look at a row, unstick a workflow | running the platform day to day |

Both are audited into `audit_events`, so a school can see either.

```bash
cd backend
.venv/bin/python manage.py createsuperuser     # then open http://127.0.0.1:8000/admin/
```

The back office is on by default and switched off with
`DJANGO_ADMIN_ENABLED=False`; `DJANGO_ADMIN_URL` moves it off `/admin/`. In
production it needs HTTPS, and `eduai.E009` fails the deploy check if the
session cookie is not marked secure — an admin cookie in clear hands somebody
the whole database.

**What it will not let you edit**: payments, invoices and the audit trail. Those
are records of something that already happened at the gateway, was issued to a
customer, or was done to a school. Editing one does not change what happened; it
only makes two sources disagree, with this one wrong.

## Making the first Super Admin

The account must exist first — `public.users.id` carries a foreign key to
`auth.users.id`, so Django cannot create an identity. The person signs up
through the product, then:

```bash
make dev-backend                       # or any shell with the venv active
cd backend
.venv/bin/python manage.py set_role someone@example.com SuperAdmin
.venv/bin/python manage.py set_role someone@example.com SuperAdmin --dry-run   # look first
```

Other roles work the same way, and the schema's own rule is enforced before the
database meets it — `users_role_school_scope_check` requires exactly SchoolAdmin
and Teacher to carry a school:

```bash
manage.py set_role head@school.test SchoolAdmin --school school-abc123
manage.py set_role teacher@school.test Teacher   --school school-abc123
manage.py set_role parent@example.com  Parent                  # no school, ever
```

Every change writes an `account.role.changed` audit row. A role change is the
most privileged edit in the product and "who made this person a Super Admin"
has to be answerable later.

**There is one other path, and it is a stopgap**: `app/src/app/api/profile+api.ts`
recognises a single hardcoded email as the SuperAdmin so the very first account
could bootstrap itself before this command existed. It should go once a Super
Admin exists by the route above.

## What a Super Admin can and cannot do

A Super Admin runs the platform: approve, reject, suspend and reactivate
schools; read the audit trail; manage the plan catalogue. What they do **not**
have is silent access to a school's children.

Cross-tenant reads need an expiring `SupportAccessGrant`, and each one writes a
`support.cross_tenant_read` audit row (matrix §4, `apps/tenants/schools/tenancy.py`).
This is deliberate, and it is the design decision most likely to be mistaken for
a missing feature:

* the product's promise is that a school's student data is the school's;
* "the platform team can read any child's work, and nobody can tell" is exactly
  what a school's data-protection officer asks about;
* a grant makes the access **possible and accountable**, rather than impossible
  or invisible.

A Super Admin also cannot grade. Authority here is a capability matrix, not a
rank ladder: `TEACHING_GRADING_RUN` belongs to the teacher who is answerable for
the mark, and no amount of seniority substitutes for that.

If the product needs ungated cross-tenant access, that is a policy change to
make deliberately — change the matrix, not the check.

## Parents are standalone B2C

A Parent has **no school**. `users_role_school_scope_check` forbids one, so the
ordinary tenant filter does not describe a parent at all.

* They sign up themselves (`POST /api/v1/accounts/parents`) — the one account in
  the product a person creates for themselves.
* They reach a child only through `parent_student_links`, created by redeeming
  an invite code the child's teacher issued. That is the only path, and the
  link carries its own `school_id`, so one parent can hold children at several
  schools.
* Revoking a link ends the access. Restoring it needs a **new** code (M18): an
  old one cannot undo a safeguarding decision.

**What a parent sees is narrower than "their child's papers", on purpose.** The
matrix gives a parent `student.report.read` and `student.resources.read` and
withholds `student.raw_file.read`, `student.ocr_text.read` and
`student.ai_rationale.read`. So a parent sees the teacher-approved report,
feedback and practice material — not the scanned answer sheet, not the OCR
transcript, and not the AI's reasoning. `public.parent_child_reports` selects
field by field, so those three are structurally absent rather than filtered out.

That is a product decision, not an oversight: the teacher is the author of the
mark, and a parent reading raw AI output would be reading something no teacher
approved. If parents should see the scanned paper itself, that is a matrix
change plus a read-model change — ask for it explicitly.
