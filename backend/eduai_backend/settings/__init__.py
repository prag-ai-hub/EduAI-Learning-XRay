"""Settings package.

Never import this module directly. Select an environment explicitly:

    DJANGO_SETTINGS_MODULE=eduai_backend.settings.dev    # local development
    DJANGO_SETTINGS_MODULE=eduai_backend.settings.test   # automated tests
    DJANGO_SETTINGS_MODULE=eduai_backend.settings.prod   # production

`base` holds everything shared and reads all secrets from the environment.
"""
