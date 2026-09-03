"""Identity and profile tables.

Every model here is `managed = False`. These tables were created by the SQL
migrations in ../../supabase/migrations and are shared with the Next.js app,
which keeps reading and writing them. Django maps them so it can query; it
never owns their shape. Schema changes go through a new SQL migration, then
`manage.py inspectdb` to re-derive the mapping.

`on_delete=DO_NOTHING` throughout: Postgres already declares the referential
action on each foreign key, and a second, possibly different cascade defined
in Python would be a silent divergence.
"""

from django.db import models

from .roles import CHOICES as ROLE_CHOICES


class User(models.Model):
    """A row of `public.users` - the profile extension of `auth.users`.

    NOT `django.contrib.auth.models.User`, and never used to authenticate.
    Identity belongs to Supabase; this table holds the product's view of a
    person (role, school, credits) keyed by the same uuid as `auth.users.id`,
    which is what M5 unified. `SupabasePrincipal.id` is this `id`.

    **Django cannot create a row here.** `id` carries a foreign key to
    `auth.users.id` (M13, ON DELETE CASCADE), so an identity must exist in
    Supabase Auth first. School registration and parent sign-up therefore go
    through Supabase to create the identity, and reach this table only to
    attach or update the profile. `role` and `school` are writable; the row's
    existence is not Django's to decide.

    The role/school pairing is constrained: `users_role_school_scope_check`
    requires `school_id IS NOT NULL` for exactly SchoolAdmin and Teacher, so a
    SuperAdmin and a Parent both have no school. A Parent reaches their
    children through `parents.ParentStudentLink`, never through a school.
    """

    class Status(models.TextChoices):
        ACTIVE = "Active", "Active"
        DISABLED = "Disabled", "Disabled"

    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey(
        "schools.School",
        models.DO_NOTHING,
        blank=True,
        null=True,
        related_name="users",
    )
    name = models.TextField()
    email = models.TextField()
    role = models.TextField(choices=ROLE_CHOICES)
    phone = models.TextField(blank=True, null=True)
    status = models.TextField()
    profile_json = models.JSONField()
    total_credits = models.IntegerField()
    used_credits = models.IntegerField()
    disabled_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "users"
        unique_together = (("school", "email"),)

    def __str__(self) -> str:
        return f"{self.email} ({self.role})"

    @property
    def credits_remaining(self) -> int:
        return self.total_credits - self.used_credits


class Invitation(models.Model):
    """A pending invitation to join a school.

    Note the role constraint is narrower than `users.role`: a SuperAdmin
    cannot be invited, only promoted.
    """

    class Status(models.TextChoices):
        PENDING = "Pending", "Pending"
        ACCEPTED = "Accepted", "Accepted"
        EXPIRED = "Expired", "Expired"
        REVOKED = "Revoked", "Revoked"

    # invitations_role_check - deliberately excludes SuperAdmin.
    INVITABLE_ROLES = ("SchoolAdmin", "Teacher", "Parent")

    id = models.UUIDField(primary_key=True)
    email = models.TextField()
    name = models.TextField()
    role = models.TextField(choices=[(r, r) for r in INVITABLE_ROLES])
    credits = models.IntegerField()
    school = models.ForeignKey(
        "schools.School",
        models.DO_NOTHING,
        blank=True,
        null=True,
        related_name="invitations",
    )
    invited_by = models.ForeignKey(
        User, models.DO_NOTHING, db_column="invited_by", related_name="invitations_sent"
    )
    status = models.TextField(choices=Status.choices)
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "invitations"

    def __str__(self) -> str:
        return f"{self.email} -> {self.role} ({self.status})"
