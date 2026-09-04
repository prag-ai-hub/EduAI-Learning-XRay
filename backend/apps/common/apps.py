from django.apps import AppConfig


class CommonConfig(AppConfig):
    name = "apps.common"
    verbose_name = "Common"

    def ready(self):
        # Importing is what registers them: @register only runs on import, and
        # nothing else imports this module.
        from . import checks  # noqa: F401
