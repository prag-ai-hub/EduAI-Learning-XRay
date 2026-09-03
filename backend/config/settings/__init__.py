"""Settings package.

Never import this module directly. Select an environment explicitly:

    DJANGO_SETTINGS_MODULE=config.settings.dev    # local development
    DJANGO_SETTINGS_MODULE=config.settings.test   # automated tests
    DJANGO_SETTINGS_MODULE=config.settings.prod   # production

`base` holds everything shared and reads all secrets from the environment.
"""
