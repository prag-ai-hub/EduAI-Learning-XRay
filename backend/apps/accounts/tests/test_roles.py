from apps.accounts import roles


def test_the_four_roles_are_exactly_these():
    assert set(roles.ALL_ROLES) == {"SuperAdmin", "SchoolAdmin", "Teacher", "Parent"}


def test_only_school_admin_and_teacher_are_school_scoped():
    # Mirrors users_role_school_scope_check: SuperAdmin and Parent carry no
    # school. A parent reaches children through parent_student_links instead.
    assert roles.is_school_scoped(roles.SCHOOL_ADMIN)
    assert roles.is_school_scoped(roles.TEACHER)
    assert not roles.is_school_scoped(roles.SUPER_ADMIN)
    assert not roles.is_school_scoped(roles.PARENT)


def test_normalize_maps_the_pre_m7_admin_value():
    assert roles.normalize("Admin") == roles.SCHOOL_ADMIN


def test_normalize_rejects_anything_unrecognised():
    # Returning None rather than defaulting to Teacher: silently promoting an
    # unknown role to a real one is how an authorisation bug hides.
    for value in ("", None, "root", "superadmin", "super_admin", "TEACHER"):
        assert roles.normalize(value) is None


def test_normalize_passes_known_roles_through():
    for role in roles.ALL_ROLES:
        assert roles.normalize(role) == role


def test_there_is_no_rank_ordering():
    # Authority here does not flow downward - a SchoolAdmin cannot grade. A
    # rank helper would invite exactly that mistake, so it must stay absent.
    assert not hasattr(roles, "RANK")
    assert not hasattr(roles, "outranks_or_equals")
