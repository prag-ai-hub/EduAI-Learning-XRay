from django.apps import AppConfig


class BillingConfig(AppConfig):
    name = "apps.billing.subscriptions"
    # The directory moved under the `billing` group; the label must not follow
    # it. Sibling models point here by label - `schools.School.plan` is a FK to
    # "billing.Plan" - and `django_migrations` records the label too. Renaming
    # it to `subscriptions` would break both.
    label = "billing"
    verbose_name = "Plans, subscriptions, payments and invoices"
