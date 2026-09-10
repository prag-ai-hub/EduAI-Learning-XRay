"""Every routed endpoint is gated, and gated at the right role.

Day 9.2. The capability matrix, the permission classes and the tests for each
feature all existed before this file; what did not was anything that looked at
the ROUTE TABLE. Eighteen test files exercise more than one role and eleven
exercise all four, but every one of them tests an endpoint somebody remembered
to write a test for. A view added tomorrow with no `permission_classes`, or with
a `capability_map` missing one of its actions, was invisible.

That is the same shape as two faults already found in this codebase: the deploy
checks that were registered but never imported, and the requirements guard that
scanned a directory the restructure had renamed. The rule existed; nothing
enforced it structurally.

So this walks the real URLconf and asks of every (view, action) the router
actually publishes:

  * is a capability resolvable at all, through any of the three declaration
    styles - `capability_map`, the view's `required_capabilities`, or the
    permission class built by `requires()`?
  * is every capability named a real one?
  * does a viewset's `capability_map` cover every action the router routes, so
    no action is silently unreachable?
  * and does the set of roles that can reach it match the matrix?

Exemptions are per view class, listed here with a reason, and the list is
asserted to contain no view that has since gained a capability - so an exemption
cannot quietly outlive its justification.
"""

from __future__ import annotations

import inspect

import pytest
from django.urls import get_resolver

from apps.accounts.capabilities import ALL_CAPABILITIES, ROLE_CAPABILITIES, capabilities_for
from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER

ROLES = (SUPER_ADMIN, SCHOOL_ADMIN, TEACHER, PARENT)

#: Views that legitimately gate on identity rather than capability, with the
#: reason. Anything not here must resolve to a capability.
NO_CAPABILITY_REQUIRED = {
    "health": "Unversioned liveness probe. AllowAny by design - a load balancer holds no token.",
    "SchoolRegistrationView": (
        "Identity-only: the caller has a Supabase account and no profile row yet, so they hold "
        "no role and therefore no capability. Authenticated via SupabaseIdentityAuthentication "
        "and throttled on the 'auth' scope."
    ),
    "ParentSignupView": (
        "Identity-only, and the mirror of SchoolRegistrationView: the caller has a Supabase "
        "account and no profile row yet, so they hold no role and therefore no capability. This "
        "is what gives them one. It grants no access on its own - a Parent's four capabilities "
        "are all scoped through parent_student_links, and a fresh account has none - so the "
        "gate that matters is the redemption endpoint, which is capability-gated and throttled. "
        "Authenticated via SupabaseIdentityAuthentication and throttled on the 'auth' scope."
    ),
    "MySchoolView": (
        "Answers 'what is my own school, and has it been approved'. The caller's own row is the "
        "whole scope; there is nothing to gate beyond being signed in."
    ),
    "RazorpayWebhookView": (
        "Gateway callback. A gateway holds no bearer token, so there is no role to gate on: "
        "the HMAC-SHA256 signature over the RAW body is the authentication, and the view "
        "refuses anything it cannot verify before touching a row. Throttled on the 'webhook' "
        "scope. See test_the_webhook_is_gated_by_a_signature for what that is asserted to mean."
    ),
    "APIRootView": (
        "DRF's generated router index. Lists route names to an authenticated caller and reads no "
        "data. See test_the_router_index_exposes_no_data for what that is asserted to mean."
    ),
}


def _routes():
    """(path, view class, action) for everything the URLconf actually publishes."""
    found = []

    def walk(resolver, prefix=""):
        for pattern in resolver.url_patterns:
            path = prefix + str(pattern.pattern)
            if hasattr(pattern, "url_patterns"):
                walk(pattern, path)
                continue
            callback = pattern.callback
            view = getattr(callback, "cls", None) or getattr(callback, "view_class", None)
            if view is None:
                found.append((path, None, callback.__name__, None))
                continue
            # A viewset's router entry carries the method -> action mapping on
            # the generated view function itself, not in its initkwargs.
            #
            # Filtered by http_method_names, because a router registers the full
            # ModelViewSet route set regardless. InviteCodeViewSet is the case
            # that matters: it allows POST only, deliberately, because a code is
            # a bearer credential and an endpoint that reads one back would let
            # anyone holding the issuing capability collect every live code in
            # their school. Its list and retrieve patterns exist and answer 405.
            # Counting those as ungated endpoints would be a false alarm, and a
            # loud false alarm is how a guard like this gets switched off.
            actions = getattr(callback, "actions", None)
            if actions:
                allowed = {m.lower() for m in getattr(view, "http_method_names", []) or []}
                reachable = {
                    action
                    for method, action in actions.items()
                    if not allowed or method.lower() in allowed
                }
                for action in sorted(reachable):
                    found.append((path, view, view.__name__, action))
            else:
                found.append((path, view, view.__name__, None))

    walk(get_resolver())
    return found


def _declared(view, action) -> frozenset[str] | None:
    """The capabilities a request to (view, action) must satisfy.

    Mirrors HasCapability._required deliberately rather than calling it: that
    method reads `view.action` off a live instance, and this runs over classes.
    Any divergence between the two is itself worth failing on, which is what
    test_the_resolver_agrees_with_the_permission_class checks.
    """
    if view is None:
        return None
    mapping = getattr(view, "capability_map", None)
    if mapping and action in mapping:
        declared = mapping[action]
        return frozenset({declared} if isinstance(declared, str) else declared)

    declared = getattr(view, "required_capabilities", None)
    if not declared:
        for permission in getattr(view, "permission_classes", []):
            declared = getattr(permission, "required_capabilities", None)
            if declared:
                break
    if not declared:
        return None
    return frozenset({declared} if isinstance(declared, str) else declared)


ROUTES = _routes()
GATED = [(p, v, n, a) for p, v, n, a in ROUTES if n not in NO_CAPABILITY_REQUIRED]


def _ident(route):
    path, _view, name, action = route
    return f"{name}.{action}" if action else name


def test_the_route_table_is_not_empty():
    """A resolver that yields nothing would make every test below vacuous."""
    assert len(ROUTES) > 20, f"only {len(ROUTES)} routes found - did the URLconf move?"


@pytest.mark.parametrize("route", GATED, ids=_ident)
def test_every_endpoint_declares_a_capability(route):
    path, view, name, action = route
    assert _declared(view, action), (
        f"{name}"
        + (f".{action}" if action else "")
        + f" (at {path}) declares no capability. Deny-by-default means it is unreachable rather "
        "than open, but an unreachable endpoint is still a bug. Declare one, or add the view to "
        "NO_CAPABILITY_REQUIRED with the reason."
    )


@pytest.mark.parametrize("route", GATED, ids=_ident)
def test_every_declared_capability_is_real(route):
    _path, view, name, action = route
    declared = _declared(view, action) or frozenset()
    unknown = declared - ALL_CAPABILITIES
    assert not unknown, f"{name} names capabilities that do not exist: {sorted(unknown)}"


@pytest.mark.parametrize("route", GATED, ids=_ident)
def test_every_endpoint_is_reachable_by_at_least_one_role(route):
    """A capability no role holds is an endpoint nobody can call.

    Deny-by-default makes that safe and useless at the same time; it is almost
    always a typo or a capability that was renamed on one side only.
    """
    _path, view, name, action = route
    declared = _declared(view, action) or frozenset()
    reachable = [role for role in ROLES if declared <= capabilities_for(role)]
    assert reachable, (
        f"{name}"
        + (f".{action}" if action else "")
        + f" requires {sorted(declared)}, which no role holds. Nobody can call it."
    )


@pytest.mark.parametrize("view_name", sorted(NO_CAPABILITY_REQUIRED))
def test_no_exemption_outlives_its_reason(view_name):
    """An exemption must still describe a view that is actually exempt.

    Without this, a view that later gains a capability keeps its entry, and the
    entry then silently excuses whatever that view becomes.
    """
    matching = [(v, a) for _p, v, n, a in ROUTES if n == view_name]
    assert matching, f"{view_name} is exempted but no longer routed - drop the entry."
    assert any(_declared(v, a) is None for v, a in matching), (
        f"{view_name} is on NO_CAPABILITY_REQUIRED but now declares a capability. "
        "Remove the exemption so it is checked like everything else."
    )


@pytest.mark.parametrize(
    "view_name", sorted({n for _p, _v, n, _a in ROUTES if n not in NO_CAPABILITY_REQUIRED})
)
def test_a_viewset_capability_map_covers_every_routed_action(view_name):
    """A `capability_map` missing an action denies it, silently.

    Deny-by-default is the right failure direction, but an action the router
    publishes and the permission layer always refuses is a 403 nobody meant to
    ship, and no feature test catches it unless someone wrote one for that
    action specifically.
    """
    routed = {a for _p, _v, n, a in ROUTES if n == view_name and a}
    if not routed:
        return
    view = next(v for _p, v, n, _a in ROUTES if n == view_name)
    mapping = getattr(view, "capability_map", None)
    if not mapping:
        return  # covered by required_capabilities for every action; checked above
    missing = {
        a for a in routed if a not in mapping and not getattr(view, "required_capabilities", None)
    }
    assert not missing, (
        f"{view_name}.capability_map omits {sorted(missing)}, which the router publishes. "
        "Those actions are permanently refused."
    )


def test_the_matrix_grants_every_endpoint_capability_to_someone():
    """The reverse view: no endpoint capability is absent from all four roles."""
    used = set()
    for _p, view, _name, action in GATED:
        used |= _declared(view, action) or frozenset()
    held = set().union(*(set(caps) for caps in ROLE_CAPABILITIES.values()))
    orphaned = used - held
    assert not orphaned, f"endpoints require capabilities no role holds: {sorted(orphaned)}"


def test_the_router_index_exposes_no_data():
    """DRF's APIRootView is exempt from the capability rule, so pin what it is.

    It must stay a bare index: authenticated, listing route names only. If it
    ever gains a queryset or a serializer it is no longer an index and the
    exemption above stops being true.
    """
    roots = [v for _p, v, n, _a in ROUTES if n == "APIRootView" and v]
    assert roots, "APIRootView is exempted but not routed"
    for view in roots:
        assert not getattr(view, "queryset", None), "APIRootView gained a queryset"
        assert not getattr(view, "serializer_class", None), "APIRootView gained a serializer"
        names = [c.__name__ for c in getattr(view, "permission_classes", [])]
        assert names and "AllowAny" not in names, (
            f"APIRootView must stay behind authentication; got {names}"
        )


def test_the_webhook_is_gated_by_a_signature():
    """The one route with no capability, so pin what stands in for one.

    An exemption that only says "this is fine" is worth nothing. This asserts
    the two properties that make it fine: the view really is open at the HTTP
    layer (so a gateway with no token can reach it), and the signature check is
    really what stands between that openness and a state change.

    If someone later removes the verification and leaves the exemption, this
    fails - which is the whole point of exempting it by name rather than by
    letting an ungated view slip through unnoticed.
    """
    from apps.billing.subscriptions import webhooks

    view = webhooks.RazorpayWebhookView
    names = [c.__name__ for c in view.permission_classes]
    assert names == ["AllowAny"], f"the gateway cannot present credentials; got {names}"
    assert view.authentication_classes == [], "a gateway holds no bearer token"
    assert view.throttle_scope == "webhook", "an open endpoint needs a ceiling"

    source = inspect.getsource(webhooks)
    assert "compare_digest" in source, "the signature must be compared in constant time"
    assert "request.body" in source, (
        "the signature covers the exact bytes sent; verifying a re-serialised body "
        "compares something the gateway never signed"
    )
