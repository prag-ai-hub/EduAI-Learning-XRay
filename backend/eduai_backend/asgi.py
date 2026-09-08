import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "eduai_backend.settings.prod")

application = get_asgi_application()
