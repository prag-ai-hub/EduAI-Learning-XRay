"""requirements.txt must declare everything the code imports.

The standing rule is that any new library is added to requirements.txt. This
turns that into something the build enforces: add an import without declaring
it and the suite fails here, rather than at `pip install` on a machine that
happened not to have it already.

It reads the source rather than the installed environment, so a package that is
present only because something else pulled it in still counts as undeclared.
"""

from __future__ import annotations

import ast
import re
import sys
from importlib.metadata import packages_distributions
from importlib.util import find_spec
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REQUIREMENTS = BACKEND / "requirements.txt"

#: Packages defined in this repository, not installed from an index.
LOCAL = {"apps", "config", "tests", "conftest"}

#: Imported under a name that differs from the distribution that ships it.
KNOWN_ALIASES = {
    "jwt": "PyJWT",
    "rest_framework": "djangorestframework",
    "environ": "django-environ",
    "corsheaders": "django-cors-headers",
}


def declared() -> set[str]:
    """Distribution names listed in requirements.txt, lowercased."""
    names = set()
    for line in REQUIREMENTS.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        # "psycopg[binary]~=3.2.0" -> "psycopg"
        name = re.split(r"[<>=!~\[]", line, maxsplit=1)[0].strip()
        if name:
            names.add(name.lower())
    return names


def source_files() -> list[Path]:
    roots = [BACKEND / "apps", BACKEND / "config", BACKEND / "tests"]
    files = [p for root in roots for p in root.rglob("*.py")]
    files.append(BACKEND / "conftest.py")
    return [p for p in files if ".venv" not in p.parts]


def imported_top_levels() -> set[str]:
    modules: set[str] = set()
    for path in source_files():
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                # Skip relative imports: `from .models import User` is local.
                if node.level == 0 and node.module:
                    modules.add(node.module.split(".")[0])
    return modules


def third_party(modules: set[str]) -> set[str]:
    return {m for m in modules if m not in sys.stdlib_module_names and m not in LOCAL}


def distribution_for(module: str, listed: set[str]) -> str | None:
    if module in KNOWN_ALIASES:
        return KNOWN_ALIASES[module]

    provided = packages_distributions().get(module)
    if provided:
        return provided[0]

    # Not every wheel ships the top-level metadata packages_distributions()
    # reads - hatchling-built ones such as httpx do not - so fall back to the
    # module name when the package is importable and named in the file.
    if find_spec(module) and module.replace("_", "-").lower() in listed:
        return module
    return None


def test_requirements_file_is_the_only_one():
    # A split base/dev/prod set means a package can be added to the wrong one
    # and only fail in the environment nobody tested.
    assert REQUIREMENTS.exists()
    assert not (BACKEND / "requirements").exists(), "the split requirements/ directory is back"


def test_every_third_party_import_is_declared():
    undeclared = []
    listed = declared()
    for module in sorted(third_party(imported_top_levels())):
        distribution = distribution_for(module, listed)
        if distribution is None:
            undeclared.append(f"{module} (not installed - is it a typo?)")
        elif distribution.lower() not in listed:
            undeclared.append(f"{module} -> {distribution}")
    assert not undeclared, "imported but not in requirements.txt: " + ", ".join(undeclared)


def test_every_requirement_is_pinned():
    # An unpinned dependency makes two installs of the same commit differ.
    unpinned = []
    for line in REQUIREMENTS.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line and not re.search(r"[<>=~]=", line):
            unpinned.append(line)
    assert not unpinned, f"unpinned: {unpinned}"


def test_the_runtime_essentials_are_present():
    listed = declared()
    for package in ("django", "djangorestframework", "psycopg", "gunicorn", "pyjwt"):
        assert package in listed, f"{package} missing from requirements.txt"
