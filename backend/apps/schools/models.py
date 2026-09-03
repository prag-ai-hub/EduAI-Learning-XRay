"""Schools, their roster, and cross-tenant support access.

All unmanaged - see apps/accounts/models.py for the rule and the reasoning.

`School` and `SupportAccessGrant` are this app's own concern. `SchoolClass`
and `Student` are roster tables owned by the teaching surface in
../../frontend; Django maps them because the parent portal's authorisation
path (`parents.ParentStudentLink`) terminates at a student, and a foreign key
needs something to point at. Treat them as read-only from here.
"""

from django.db import models


class School(models.Model):
    """A tenant.

    `id` is `text`, not `uuid`, and deliberately so: the existing values look
    like `school-{uuid}` and are embedded in the JSON workspace blobs the
    teaching surface stores. Do not "fix" it.
    """

    class Status(models.TextChoices):
        PENDING = "Pending", "Pending"
        ACTIVE = "Active", "Active"
        SUSPENDED = "Suspended", "Suspended"
        CLOSED = "Closed", "Closed"

    id = models.TextField(primary_key=True)
    name = models.TextField()
    city = models.TextField(blank=True, null=True)
    board = models.TextField(blank=True, null=True)
    settings_json = models.JSONField()

    # The pending -> approved -> suspended lifecycle (Day 6).
    status = models.TextField(choices=Status.choices)
    approved_at = models.DateTimeField(blank=True, null=True)
    approved_by = models.ForeignKey(
        "accounts.User",
        models.DO_NOTHING,
        db_column="approved_by",
        blank=True,
        null=True,
        related_name="schools_approved",
    )
    suspended_at = models.DateTimeField(blank=True, null=True)

    # Denormalised for listings only. NEVER read this to decide an
    # entitlement - `billing.Subscription` is authoritative. The database
    # carries the same warning as a column comment.
    plan = models.ForeignKey(
        "billing.Plan",
        models.DO_NOTHING,
        blank=True,
        null=True,
        related_name="schools",
    )

    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "schools"

    def __str__(self) -> str:
        return f"{self.name} ({self.status})"

    @property
    def is_operational(self) -> bool:
        return self.status == self.Status.ACTIVE


class SchoolClass(models.Model):
    """`public.classes`. Named SchoolClass because `class` is a keyword.

    Owned by the teaching surface. Mapped here only so `Student.school_class`
    resolves.
    """

    id = models.TextField(primary_key=True)
    school = models.ForeignKey(School, models.DO_NOTHING, related_name="classes")
    academic_year = models.TextField()
    # classes_class_name_check: '1'..'12'.
    class_name = models.TextField()
    section = models.TextField()
    subject = models.TextField()
    teacher = models.ForeignKey(
        "accounts.User",
        models.DO_NOTHING,
        blank=True,
        null=True,
        related_name="classes_taught",
    )
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "classes"

    def __str__(self) -> str:
        return f"{self.class_name}-{self.section} {self.subject}"


class Student(models.Model):
    """A student on a school's roster. Owned by the teaching surface.

    Carries no direct link to a parent: that relationship lives in
    `parents.ParentStudentLink` and exists only there.
    """

    id = models.TextField(primary_key=True)
    school = models.ForeignKey(School, models.DO_NOTHING, related_name="students")
    school_class = models.ForeignKey(
        SchoolClass,
        models.DO_NOTHING,
        db_column="class_id",
        blank=True,
        null=True,
        related_name="students",
    )
    name = models.TextField()
    roll_number = models.TextField(blank=True, null=True)
    status = models.TextField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "students"

    def __str__(self) -> str:
        return self.name


class SupportAccessGrant(models.Model):
    """Time-boxed permission for a SuperAdmin to read one school's data.

    Cross-tenant access is not implicit in the SuperAdmin role: it needs a
    live grant. Expiry is enforced at query time, and every read under a grant
    writes an `audit.AuditEvent` row. `reason` must be at least 10 characters
    after trimming - the database rejects a blank justification.
    """

    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey(School, models.DO_NOTHING, related_name="support_grants")
    granted_to = models.ForeignKey(
        "accounts.User",
        models.DO_NOTHING,
        db_column="granted_to",
        related_name="support_grants_held",
    )
    granted_by = models.ForeignKey(
        "accounts.User",
        models.DO_NOTHING,
        db_column="granted_by",
        blank=True,
        null=True,
        related_name="support_grants_issued",
    )
    reason = models.TextField()
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "support_access_grants"

    def __str__(self) -> str:
        return f"{self.granted_to_id} -> {self.school_id} until {self.expires_at:%Y-%m-%d}"
