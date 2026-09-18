"""Give an existing account a role - including the first Super Admin.

    python manage.py set_role someone@example.com SuperAdmin
    python manage.py set_role head@school.test SchoolAdmin --school school-abc123
    python manage.py set_role someone@example.com Teacher --dry-run

--------------------------------------------------------------------------
WHY THIS EXISTS, AND WHY IT IS NOT `createsuperuser`
--------------------------------------------------------------------------
`manage.py createsuperuser` writes a row in `auth_user`, Django's own table.
**Nothing in this product reads it.** Identity is Supabase Auth, authority is
`public.users.role`, and `django.contrib.admin` is not installed - there is no
Django admin site to be a superuser of. A Django superuser here would be an
account that can sign into nothing.

So the Super Admin is a role on a real account, and this is how it gets there.
The account must already exist: `public.users.id` carries a foreign key to
`auth.users.id`, so the person signs up through the product first - with Google
or an email - and then someone runs this.

Every change is written to `audit_events`, because a role change is the single
most privileged edit in the product and "who made this person a Super Admin"
has to be answerable later.

The schema's own rule is enforced here rather than discovered:
`users_role_school_scope_check` requires exactly SchoolAdmin and Teacher to
carry a school, so promoting a SchoolAdmin to SuperAdmin drops their school, and
demoting a SuperAdmin needs `--school`.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.roles import ALL_ROLES, PARENT, SUPER_ADMIN, is_school_scoped
from apps.platform.audit.services import Action, record
from apps.tenants.schools.models import School

#: `audit_events.school_id` is NOT NULL and a SuperAdmin or Parent has no
#: school. The same sentinel `apps.billing` uses for tenant-less rows.
PLATFORM_SCOPE = "platform"


def _supabase_identity(email: str):
    """The `auth.users` id for this address, or None.

    Raw SQL because `auth` is Supabase's schema: this service maps `public`, and
    mapping somebody else's identity table would be claiming ownership of it.
    Read-only, and the only thing taken from it is the id.
    """
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute("select id from auth.users where lower(email) = lower(%s)", [email])
        row = cursor.fetchone()
    return row[0] if row else None


class Command(BaseCommand):
    help = "Set an existing account's role. The account must already exist in Supabase Auth."

    def add_arguments(self, parser):
        parser.add_argument("email", help="The account's email address, as it signed up.")
        parser.add_argument("role", choices=list(ALL_ROLES), help="The role to give them.")
        parser.add_argument(
            "--school",
            default=None,
            help="School id. Required for SchoolAdmin and Teacher; refused for the other two.",
        )
        parser.add_argument(
            "--name",
            default=None,
            help="Display name, when this command is creating the profile row.",
        )
        parser.add_argument("--dry-run", action="store_true", help="Report without writing.")

    @transaction.atomic
    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        role = options["role"]
        school_id = (options["school"] or "").strip() or None
        dry_run = options["dry_run"]

        user = User.objects.filter(email__iexact=email).first()
        created = False
        if user is None:
            # The bootstrap case, and the reason this branch exists at all: the
            # very first Super Admin has signed up in Supabase and has no
            # profile row, because the only thing that creates one is school
            # registration - which a Super Admin never does, having no school.
            # Without this, the first Super Admin could not be made at all.
            identity = _supabase_identity(email)
            if identity is None:
                raise CommandError(
                    f"No account for {email}. They sign up through the product first: Django "
                    "cannot create the identity, because public.users.id references "
                    "auth.users.id."
                )
            user = User(
                id=identity,
                email=email,
                name=(options["name"] or email.split("@")[0]).strip(),
                status=User.Status.ACTIVE,
                profile_json={},
                total_credits=0,
                used_credits=0,
                created_at=timezone.now(),
                updated_at=timezone.now(),
            )
            created = True

        # The database constraint, stated before it is met rather than after.
        if is_school_scoped(role):
            if not school_id:
                raise CommandError(f"{role} belongs to a school. Pass --school <id>.")
            if not School.objects.filter(pk=school_id).exists():
                raise CommandError(f"No school with id {school_id}.")
        elif school_id:
            raise CommandError(
                f"{role} belongs to no school - `users_role_school_scope_check` forbids one. "
                "Drop --school."
            )

        previous_role = None if created else user.role
        previous_school = None if created else user.school_id
        if (previous_role, previous_school) == (role, school_id):
            self.stdout.write(f"{email} is already {role}. Nothing to do.")
            return

        self.stdout.write(
            f"{email}: {'no profile yet' if created else previous_role}"
            f"{f' @ {previous_school}' if previous_school else ''}"
            f"  ->  {role}{f' @ {school_id}' if school_id else ''}"
        )
        if created:
            self.stdout.write(
                "  Creating the profile row for an account that has signed up and has none. "
                "This is how the first Super Admin is made."
            )
        if role == SUPER_ADMIN:
            self.stdout.write(
                self.style.WARNING(
                    "  A Super Admin can approve and suspend schools, read the audit trail and "
                    "manage plans. Cross-tenant reads still need a support grant and are audited."
                )
            )
        if previous_role == PARENT or role == PARENT:
            self.stdout.write(
                self.style.WARNING(
                    "  Parent links live in `parent_student_links` and are NOT changed here. "
                    "A former parent keeps their links until the school revokes them."
                )
            )

        if dry_run:
            self.stdout.write("Dry run: nothing written.")
            transaction.set_rollback(True)
            return

        user.role = role
        user.school_id = school_id
        user.updated_at = timezone.now()
        if created:
            user.save(force_insert=True)
        else:
            user.save(update_fields=["role", "school", "updated_at"])

        record(
            action=Action.ACCOUNT_ROLE_CHANGED,
            school_id=school_id or PLATFORM_SCOPE,
            actor_id=None,  # a command line has no signed-in actor
            entity_type="user",
            entity_id=str(user.id),
            detail={
                "email": email,
                "from": previous_role,
                "created": created,
                "to": role,
                "fromSchool": previous_school,
                "toSchool": school_id,
                "via": "manage.py set_role",
            },
        )
        self.stdout.write(
            self.style.SUCCESS("Done. The change takes effect on their next request.")
        )
