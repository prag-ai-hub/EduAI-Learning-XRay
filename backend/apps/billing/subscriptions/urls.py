"""Plans, subscriptions, B2B checkout and B2C credit top-up.

The gateway webhook and the GST invoice endpoints are not here yet. They are
built next, against `services.activate_subscription`, `services.grant_topup_credits`
and `services.gst_split`; nothing on this route table marks a payment captured,
because only a signature-verified webhook may.

The checkout routes are POST-only paths rather than viewset actions: a checkout
is a command, not a resource, and there is nothing at `/checkout/subscription`
to GET.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    PaymentHistoryViewSet,
    PlanViewSet,
    SubscriptionCancelView,
    SubscriptionCheckoutView,
    SubscriptionView,
    TopupCheckoutView,
)

app_name = "billing"

router = DefaultRouter()
router.register("plans", PlanViewSet, basename="plan")
router.register("payments", PaymentHistoryViewSet, basename="payment")

urlpatterns = [
    path("subscription", SubscriptionView.as_view(), name="subscription"),
    path("subscription/cancel", SubscriptionCancelView.as_view(), name="subscription-cancel"),
    path("checkout/subscription", SubscriptionCheckoutView.as_view(), name="checkout-subscription"),
    path("checkout/topup", TopupCheckoutView.as_view(), name="checkout-topup"),
    path("", include(router.urls)),
]
