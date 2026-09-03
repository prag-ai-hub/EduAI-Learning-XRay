"""Parent-student linking and invite codes.

All unmanaged - see apps/accounts/models.py for the rule and the reasoning.
Built by M8.

These two tables are the entire authorisation path for the B2C portal. A
parent has `school_id IS NULL` on their user row (the M7 scope constraint), so
tenant filtering by school does not apply to them: every parent-facing query
must join through `ParentStudentLink` instead. There is no other route from a
parent to a student.
"""

from django.db import models


class Relationship(models.TextChoices):
    """Shared by both tables - the same CHECK constraint appears on each."""

    MOTHER = "Mother", "Mother"
    FATHER = "Father", "Father"
    GUARDIAN = "Guardian", "Guardian"


class ParentInviteCode(models.Model):
    """A teacher- or admin-issued code that a parent redeems to link a child.

    Constraints worth knowing before writing the Day 11 redeem endpoint:

      * `code` matches ^[A-Z0-9]{6,12}$ - uppercase alphanumeric only.
      * `max_uses` is between 1 and 5, and `used_count <= max_uses` is a CHECK,
        so an over-redemption fails at the database rather than silently
        creating an extra link.
      * `expires_at > created_at` is a CHECK - a code cannot be born expired.

    Redemption must be atomic: increment `used_count` and insert the link in
    one transaction, or two concurrent redeems both pass the usage test.
    """

    id = models.UUIDField(primary_key=True)
    code = models.TextField(unique=True)
    school = models.ForeignKey(
        "schools.School", models.DO_NOTHING, related_name="parent_invite_codes"
    )
    student = models.ForeignKey("schools.Student", models.DO_NOTHING, related_name="invite_codes")
    created_by = models.ForeignKey(
        "accounts.User",
        models.DO_NOTHING,
        db_column="created_by",
        related_name="parent_invite_codes_created",
    )
    email = models.TextField(blank=True, null=True)
    relationship = models.TextField(choices=Relationship.choices)
    max_uses = models.IntegerField()
    used_count = models.IntegerField()
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "parent_invite_codes"

    def __str__(self) -> str:
        return f"{self.code} ({self.used_count}/{self.max_uses})"

    @property
    def uses_remaining(self) -> int:
        return max(self.max_uses - self.used_count, 0)


class ParentStudentLink(models.Model):
    """The authorisation record for parent access.

    Every parent-facing query joins through this table. A row with
    `status = 'revoked'` must not grant access - filter on status, not just on
    the row's existence. `(parent_user, student)` is unique, so a revoked link
    is reactivated rather than duplicated.
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        REVOKED = "revoked", "Revoked"

    class LinkedVia(models.TextChoices):
        INVITE_CODE = "invite_code", "Invite code"
        ADMIN = "admin", "Created by an admin"

    id = models.UUIDField(primary_key=True)
    parent_user = models.ForeignKey("accounts.User", models.DO_NOTHING, related_name="child_links")
    student = models.ForeignKey("schools.Student", models.DO_NOTHING, related_name="parent_links")
    # Denormalised from the student so a parent's links can be filtered by
    # tenant without a join. It must always equal student.school_id.
    school = models.ForeignKey("schools.School", models.DO_NOTHING, related_name="parent_links")
    relationship = models.TextField(choices=Relationship.choices)
    status = models.TextField(choices=Status.choices)
    linked_via = models.TextField(choices=LinkedVia.choices)
    invite_code = models.ForeignKey(
        ParentInviteCode,
        models.DO_NOTHING,
        blank=True,
        null=True,
        related_name="links",
    )
    created_at = models.DateTimeField()
    revoked_at = models.DateTimeField(blank=True, null=True)
    revoked_by = models.ForeignKey(
        "accounts.User",
        models.DO_NOTHING,
        db_column="revoked_by",
        blank=True,
        null=True,
        related_name="parent_links_revoked",
    )

    class Meta:
        managed = False
        db_table = "parent_student_links"
        unique_together = (("parent_user", "student"),)

    def __str__(self) -> str:
        return f"{self.parent_user_id} -> {self.student_id} ({self.status})"

    @property
    def grants_access(self) -> bool:
        return self.status == self.Status.ACTIVE
