"""Plans, subscriptions, checkout, receipts, invoices and the gateway webhook.

The checkout routes are POST-only paths rather than viewset actions: a checkout
is a command, not a resource, and there is nothing at `/checkout/subscription`
to GET.

`webhooks/razorpay` is the one route here with no capability and no
authentication class, and that is not an oversight. A gateway holds no bearer
token; the HMAC signature over the raw body IS the authentication, and
`RazorpayWebhookView` refuses anything it cannot verify before touching a row.
It is also the only route that may mark a payment captured - nothing a caller
can reach moves money into a settled state.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    InvoiceViewSet,
    PaymentHistoryViewSet,
    PlanViewSet,
    ReceiptViewSet,
    SubscriptionCancelView,
    SubscriptionCheckoutView,
    SubscriptionView,
    TopupCheckoutView,
)
from .webhooks import RazorpayWebhookView

app_name = "billing"

router = DefaultRouter()
router.register("plans", PlanViewSet, basename="plan")
router.register("payments", PaymentHistoryViewSet, basename="payment")
router.register("receipts", ReceiptViewSet, basename="receipt")
router.register("invoices", InvoiceViewSet, basename="invoice")

urlpatterns = [
    path("subscription", SubscriptionView.as_view(), name="subscription"),
    path("subscription/cancel", SubscriptionCancelView.as_view(), name="subscription-cancel"),
    path("checkout/subscription", SubscriptionCheckoutView.as_view(), name="checkout-subscription"),
    path("checkout/topup", TopupCheckoutView.as_view(), name="checkout-topup"),
    path("webhooks/razorpay", RazorpayWebhookView.as_view(), name="webhook-razorpay"),
    path("", include(router.urls)),
]
