"""Accounts routes.

Mounted at `/api/v1/accounts/`:

    POST parents    create the caller's own Parent profile    Identity only

One route, and it is the only place in the product where a person creates their
own profile row. Why that is a parent and nobody else is in views.py.
"""

from django.urls import path

from .views import ParentSignupView

app_name = "accounts"

urlpatterns = [
    path("parents", ParentSignupView.as_view(), name="parent-signup"),
]
