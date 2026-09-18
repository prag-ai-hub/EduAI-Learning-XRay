"""The operator back office: that it exists, that it is shut, and that it tells.

Three properties, and the middle one is the reason the other two are worth
having. The admin is a second authority path into the same rows - no capability
matrix, no tenancy filter, no support grant - so:

  * it must be reachable (there is a login page, and it can be switched off);
  * it must be closed to anyone without a Django account;
  * a write through it must reach `audit_events`, where the school can see it.

The CSP test is here because the admin was, briefly, completely unusable: the
API's `default-src 'none'` applied to every response, which blocks the admin's
stylesheets, its scripts and - silently - its own login form, since
`form-action` falls through to `default-src`.
"""

from __future__ import annotations

import pytest
from django.contrib.auth.models import User as DjangoUser
from django.test import Client

from apps.common import middleware

pytestmark = pytest.mark.django_db


@pytest.fixture
def operator(db):
    """A Django account. Deliberately unrelated to `public.users`."""
    return DjangoUser.objects.create_superuser(
        username="operator", email="ops@example.test", password="not-a-real-password"
    )


def test_the_admin_is_mounted_and_asks_for_a_login():
    response = Client().get("/admin/", follow=False)

    assert response.status_code == 302
    assert "/admin/login/" in response["Location"]


def test_an_operator_can_open_it(operator):
    client = Client()
    assert client.login(username="operator", password="not-a-real-password")

    response = client.get("/admin/")

    assert response.status_code == 200


def test_the_admin_login_page_is_not_served_the_api_content_policy():
    """`default-src 'none'` blocks the login form's own submission."""
    response = Client().get("/admin/login/")

    policy = response["Content-Security-Policy"]
    assert policy == middleware.ADMIN_CSP
    directives = dict(part.strip().split(" ", 1) for part in policy.split(";") if part.strip())
    # The three the API's policy forbids and the admin needs. `frame-ancestors`
    # and `object-src` stay 'none' in both, which is why this reads directives
    # rather than searching the string.
    assert directives["form-action"] == "'self'"
    assert directives["script-src"] == "'self'"
    assert directives["default-src"] == "'self'"


def test_the_api_keeps_the_strict_policy():
    response = Client().get("/api/v1/schools/")

    assert response["Content-Security-Policy"] == middleware.API_CSP
    assert "default-src 'none'" in response["Content-Security-Policy"]


def test_every_product_model_a_support_call_needs_is_registered():
    """Not exhaustive by design - these are the ones somebody rings up about."""
    from django.contrib import admin as django_admin

    from apps.accounts.models import User
    from apps.billing.subscriptions.models import Invoice, Payment, Plan, Subscription
    from apps.platform.audit.models import AuditEvent
    from apps.tenants.parents.models import ParentInviteCode, ParentStudentLink
    from apps.tenants.schools.models import School, SchoolClass, Student

    for model in (
        School,
        SchoolClass,
        Student,
        User,
        Plan,
        Subscription,
        Payment,
        Invoice,
        AuditEvent,
        ParentStudentLink,
        ParentInviteCode,
    ):
        assert model in django_admin.site._registry, f"{model.__name__} is not in the admin"


@pytest.mark.parametrize("model_name", ["payment", "invoice", "auditevent"])
def test_records_of_what_happened_cannot_be_edited(model_name, operator):
    """A captured payment, an issued invoice and the trail itself are records.

    Editing one does not change what happened; it makes two sources disagree,
    with this one wrong.
    """
    from django.contrib import admin as django_admin

    registered = {
        model._meta.model_name: options for model, options in django_admin.site._registry.items()
    }
    options = registered[model_name]

    assert options.has_add_permission(None) is False
    assert options.has_change_permission(None) is False
    assert options.has_delete_permission(None) is False


def test_an_edit_through_the_admin_reaches_the_schools_own_audit_trail(operator, make_school):
    """Django's LogEntry records it too, and only an operator can read that -
    the wrong audience for "who changed our school's details"."""
    from apps.platform.audit.models import AuditEvent

    school = make_school(name="Before")
    client = Client()
    client.login(username="operator", password="not-a-real-password")

    response = client.post(
        f"/admin/schools/school/{school.id}/change/",
        {
            "id": school.id,
            "name": "After",
            "city": "Pune",
            "board": "CBSE",
            "status": school.status,
        },
        follow=True,
    )

    assert response.status_code == 200
    school.refresh_from_db()
    assert school.name == "After"
    event = AuditEvent.objects.get(action="admin.object.changed", entity_id=school.id)
    assert event.detail_json["adminUser"] == "operator"
    assert "name" in event.detail_json["fields"]


def test_the_admin_is_mounted_where_the_setting_says(settings):
    """`DJANGO_ADMIN_ENABLED=False` removes it, and `DJANGO_ADMIN_URL` moves it.

    Asserted through the resolver rather than by reading the URLconf's source:
    what matters is that the route exists, not how it got there.
    """
    from django.urls import reverse

    assert settings.ADMIN_ENABLED is True
    assert reverse("admin:index") == f"/{settings.ADMIN_URL}"


def test_a_new_row_gets_the_id_and_timestamps_the_form_cannot_show(operator, make_school):
    """Adding through the admin used to be impossible, silently.

    `id`, `created_at` and `updated_at` are server-owned and therefore read-only
    on the form, so they never came back in the POST - and these tables are
    `managed = False` with no Django-side default, because the schema belongs to
    `supabase/migrations`. Every add ended in a NOT NULL violation, on every
    registered model.
    """
    from apps.tenants.schools.models import Student

    school = make_school()
    client = Client()
    client.login(username="operator", password="not-a-real-password")

    response = client.post(
        "/admin/schools/student/add/",
        {"school": school.id, "name": "Aarav Sharma", "roll_number": "7B-14", "status": "Active"},
        follow=True,
    )

    assert response.status_code == 200
    student = Student.objects.get(school_id=school.id, name="Aarav Sharma")
    # The API's own shape, so a row added here is indistinguishable from one
    # added through the product.
    assert student.id.startswith("student-")
    assert student.created_at is not None
    assert student.updated_at is not None


def test_an_edit_bumps_updated_at(operator, make_school):
    school = make_school(name="Before")
    before = school.updated_at
    client = Client()
    client.login(username="operator", password="not-a-real-password")

    client.post(
        f"/admin/schools/school/{school.id}/change/",
        {
            "id": school.id,
            "name": "After",
            "city": "Pune",
            "board": "CBSE",
            "status": school.status,
        },
        follow=True,
    )

    school.refresh_from_db()
    assert school.updated_at > before


@pytest.mark.parametrize(
    ("model_name", "why"),
    [
        ("user", "a profile needs a Supabase identity behind it"),
        ("parentstudentlink", "only redeeming a code links a parent to a child"),
        ("parentinvitecode", "a code issued here would have no code"),
    ],
)
def test_rows_the_product_alone_may_create_cannot_be_added_here(model_name, why, operator):
    from django.contrib import admin as django_admin

    registered = {
        model._meta.model_name: options for model, options in django_admin.site._registry.items()
    }

    assert registered[model_name].has_add_permission(None) is False, why


def test_a_support_grant_cannot_be_edited_back_open(operator):
    """The grant is the whole control on a Super Admin reading a school's data.

    Expiry and revocation are what make cross-tenant access accountable rather
    than merely possible; an editable `expires_at` would hand somebody with
    back-office access an indefinite one, still audited as authorised.
    """
    from django.contrib import admin as django_admin

    from apps.tenants.schools.models import SupportAccessGrant

    options = django_admin.site._registry[SupportAccessGrant]

    assert options.has_change_permission(None) is False
    assert options.has_add_permission(None) is False
    assert options.has_delete_permission(None) is False
