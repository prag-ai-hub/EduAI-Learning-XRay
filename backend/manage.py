#!/usr/bin/env python
"""Django's command-line utility for the EduAI hybrid backend."""

import os
import sys


def main() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:  # pragma: no cover - import guard
        raise ImportError(
            "Django is not importable. Activate the virtualenv and install "
            "requirements: python -m venv .venv && . .venv/bin/activate && "
            "pip install -r requirements/dev.txt"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
