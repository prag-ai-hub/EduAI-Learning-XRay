"""The secrets audit, as something the build runs rather than something a human remembers.

The delivery plan schedules this audit twice - once on Day 8 and again on Day 19
- which is the tell that it should not be a reading of two files. A leak is
introduced by the commit that adds a key, not by the one that is audited, so the
check has to sit where every commit passes through.

Six exposures are covered, and each test names the one it prevents:

* a filled-in value in a tracked `.env.example`;
* a real `.env` reaching the index, or a `.gitignore` rule that exists but does
  not actually match the path it was written for;
* a provider credential pasted into source;
* the same, in git history, where redacting the working tree does not help;
* an `EXPO_PUBLIC_*` name that promises a secret into the app bundle;
* a server-side credential declared on the client side of the split.

Nothing here prints a candidate value. A failing assertion gives the file, the
line and the reason - enough to find it, not enough to leak it a second time
into CI logs that are usually more widely readable than the repository.

See docs/SECRETS-AND-ROTATION.md for the inventory and the rotation order.
"""

from __future__ import annotations

import math
import re
import shutil
import subprocess
from collections import Counter
from functools import cache
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
GIT = shutil.which("git")

#: Every env template the repo ships. Discovered, not listed: a workspace added
#: later brings its template into the audit without anyone remembering to.
ENV_EXAMPLES = sorted(p for p in REPO.glob("*/.env.example") if ".venv" not in p.parts) + [
    REPO / ".env.example"
]

DOC = REPO / "docs" / "SECRETS-AND-ROTATION.md"


# --- running git -----------------------------------------------------------


def git(*args: str) -> str:
    """Ask git itself. Parsing .gitignore or the index by hand reproduces bugs."""
    if GIT is None or not (REPO / ".git").exists():
        pytest.skip("not a git checkout - the index and ignore rules cannot be consulted")
    # S603: the argument vector is built here from literals and repo paths, and
    # GIT is an absolute path from shutil.which, so there is no shell to inject into.
    proc = subprocess.run(  # noqa: S603
        [GIT, "-C", str(REPO), *args], capture_output=True, text=True, check=False
    )
    if proc.returncode not in (0, 1):  # 1 is "no match" for check-ignore and grep
        pytest.fail(f"git {' '.join(args)} failed: {proc.stderr.strip()}")
    return proc.stdout


# --- what a credential looks like ------------------------------------------

#: Prefixes the providers themselves guarantee, each paired with the literal
#: strings any match must contain. The literals are a pre-filter: `in` on a str
#: is a memchr-backed search and runs orders of magnitude faster than the regex,
#: and every pattern here starts with a fixed string, so a blob holding none of
#: them cannot match. Scanning history means reading every blob in the object
#: store, and eleven full regex passes over each is the difference between a
#: two-second suite and a twenty-second one.
#:
#: These are worth matching on their own, alongside the entropy floor below,
#: because a short or low-entropy key still starts with its provider's prefix.
SECRET_PREFIXES = (
    (("sk-",), re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"), "OpenAI API key"),
    (
        ("sk_live_", "sk_test_"),
        re.compile(r"\bsk_(?:live|test)_[A-Za-z0-9]{16,}"),
        "provider secret key",
    ),
    (("rzp_",), re.compile(r"\brzp_(?:live|test)_[A-Za-z0-9]{10,}"), "Razorpay key"),
    (("GOCSPX-",), re.compile(r"\bGOCSPX-[A-Za-z0-9_-]{10,}"), "Google OAuth client secret"),
    (("AKIA",), re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS access key id"),
    (("ASIA",), re.compile(r"\bASIA[0-9A-Z]{16}\b"), "AWS temporary access key id"),
    (
        ("ghp_", "gho_", "ghu_", "ghs_", "ghr_"),
        re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"),
        "GitHub token",
    ),
    (
        ("PRIVATE KEY",),
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
        "private key PEM",
    ),
    # A three-part JWT. Supabase service-role keys are exactly this, and one of
    # them is full database access with RLS disabled.
    (
        ("eyJ",),
        re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),
        "JWT (a Supabase service-role key is one)",
    ),
)

#: A connection string carries the password inline, so it leaks by being pasted
#: into a README as readily as by being committed in an env file.
_DB_URL = re.compile(r"postgres(?:ql)?://([^\s:/@]{1,64}):([^\s@/]{1,128})@([^\s:/]{1,64})")

#: A password that only answers on the loopback interface is not a shared
#: credential - the local Supabase stack documents postgres:postgres@127.0.0.1
#: in its own output. Narrow on purpose: it excuses the host, and the password
#: must still be short and unrandom, so a reused production password typed
#: against localhost is not waved through.
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

#: An unbroken alphanumeric run, which is the shape every random credential has.
_RUN = re.compile(r"[A-Za-z0-9]{20,}")

#: Subresource-integrity digests. Stripped before the entropy scan because a
#: lockfile is full of them. Stripping the digest rather than skipping the file
#: keeps the rest of the lockfile in scope - a key pasted into a dependency URL
#: is still found.
_INTEGRITY = re.compile(r"\bsha(?:1|256|384|512)-[A-Za-z0-9+/=]+")

#: Hexadecimal can never reach ENTROPY_FLOOR: log2(16) = 4.0 is the ceiling for
#: a 16-symbol alphabet and a finite sample always falls short of it - a random
#: 64-character token_hex scores about 3.69, below "downloadStudentLearningGap
#: Report" at 3.88. So the entropy scan is structurally blind to exactly the
#: shape a Django SECRET_KEY, an HMAC key and most webhook signing secrets take,
#: and hex needs a rule of its own. Length carries it instead: 32 unbroken hex
#: characters is not a word anyone typed.
#:
#: The lookbehind excludes `_`, so a prefixed opaque identifier
#: (`appgprj_6a7a...`, `cus_...`) is left alone while a standalone run after
#: `=`, `"` or whitespace - which is how a key is actually written down - is
#: caught.
_HEX_RUN = re.compile(r"(?<![0-9A-Za-z_])[0-9a-fA-F]{32,}(?![0-9A-Za-z])")

#: Above this, a 20-character run is not a name anyone typed. Measured against
#: this repository: the densest identifier in tracked source scores 3.9
#: ("downloadStudentLearningGapReport"), a random 22-character key scores 4.2.
ENTROPY_FLOOR = 4.0

#: The only way a candidate is excused, and it is a property of the value, not
#: of the file it sits in. A path-based exclusion ("tests are fine") is an open
#: door: anyone can move a real key into a tests/ directory. Editing a real key
#: to contain the word "example" breaks the key, which is the point.
SYNTHETIC_MARKERS = (
    "example",
    "placeholder",
    "dummy",
    "fake",
    "redacted",
    "changeme",
    "xxxx",
    "your_",
    "not-a-real",
    "notreal",
    "sample",
)


def shannon(text: str) -> float:
    counts = Counter(text)
    n = len(text)
    return -sum(c / n * math.log2(c / n) for c in counts.values())


def is_synthetic(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in SYNTHETIC_MARKERS)


def is_alphabet(run: str) -> bool:
    """True for a character-set constant such as a base32 or nanoid alphabet.

    Those score maximum entropy - every character appears once - and are the one
    high-entropy literal that belongs in source. They give themselves away by
    being sorted: an alphabet climbs at almost every step, a random key climbs at
    about half of them, and sorting a real key destroys it, so this cannot be
    used to smuggle one past the scan.
    """
    ascending = sum(1 for a, b in zip(run, run[1:], strict=False) if ord(b) > ord(a))
    return ascending >= 0.9 * (len(run) - 1)


@cache
def is_git_object(run: str) -> bool:
    """True if this hex run names an object that actually exists in this repo.

    A 40-character SHA quoted in a commit message or a design note is a
    reference, not a credential. Checked against the object store rather than by
    length alone, because a key that happens to be 40 characters long is not a
    SHA and must not be excused for looking like one.

    `rev-parse --verify --quiet` rather than `cat-file -e`: it exits 1 when the
    object is absent, which git() tolerates, where cat-file exits 128 and would
    be reported as git itself having failed.
    """
    if len(run) != 40:
        return False
    return bool(git("rev-parse", "--verify", "--quiet", f"{run}^{{object}}").strip())


def secret_findings(text: str) -> list[str]:
    """Reasons `text` looks like it contains a credential. Never returns the value."""
    found = []
    for anchors, pattern, label in SECRET_PREFIXES:
        if not any(anchor in text for anchor in anchors):
            continue
        for match in pattern.findall(text):
            if not is_synthetic(match):
                found.append(label)
    if "postgres" in text:
        for user, password, host in _DB_URL.findall(text):
            local_default = (
                host.lower() in _LOOPBACK_HOSTS
                and len(password) <= 20
                and not _RUN.search(password)
            )
            if not local_default and not is_synthetic(password) and not is_synthetic(user):
                found.append("database URL with a password")
    for run in _HEX_RUN.findall(text):
        if not is_synthetic(run) and not is_git_object(run):
            found.append(f"{len(run)}-character hexadecimal run")
    scanned = _INTEGRITY.sub("", text) if "sha512-" in text or "sha1-" in text else text
    for run in _RUN.findall(scanned):
        # Both classes present rules out CamelCase identifiers, which reach 3.9
        # on letters alone and would otherwise dominate the findings.
        mixed = any(c.isdigit() for c in run) and any(c.isalpha() for c in run)
        if (
            mixed
            and shannon(run) >= ENTROPY_FLOOR
            and not is_synthetic(run)
            and not is_alphabet(run)
        ):
            found.append(f"{len(run)}-character high-entropy run ({shannon(run):.1f} bits/char)")
    return found


# --- what a public value looks like ----------------------------------------

_BOOL = re.compile(r"^(?:true|false|yes|no|on|off)$", re.IGNORECASE)
_INT = re.compile(r"^\d{1,7}$")
#: No userinfo section: `https://user:pass@host` is a credential wearing a URL.
_URL = re.compile(r"^https?://[^@\s?#]{1,120}(?:[?#][^\s]{0,80})?$")
_HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]{0,62}(?::\d{1,5})?$")
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,63}\.[A-Za-z]{2,}$")
_DOTTED_PATH = re.compile(r"^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*){1,6}$")
_WORD = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,23}(?:[-_][A-Za-z0-9]{1,23}){0,4}$")

PUBLIC_SHAPES = (_BOOL, _INT, _URL, _HOST, _EMAIL, _DOTTED_PATH, _WORD)


def is_public_value(value: str) -> bool:
    """True when the value is a shape a credential cannot take.

    Inverted deliberately. A denylist of secret-looking values passes anything it
    has not seen, so the next key someone adds is exempt until it leaks; this
    passes only the handful of shapes - a host, a port, a boolean, a module path
    - that are not secrets in the first place, so a new key with a filled-in
    value fails until a human explains it.
    """
    parts = [p.strip() for p in value.split(",")] if "," in value else [value]
    return all(
        part and any(shape.match(part) for shape in PUBLIC_SHAPES) and not secret_findings(part)
        for part in parts
    )


#: A name that promises a credential must carry no value at all, whatever shape
#: it has. `MAIL_PASSWORD=postgres` parses as a harmless word and is still a
#: password sitting in a tracked file.
CREDENTIAL_NAME = re.compile(
    r"(?:SECRET|PASSWORD|PASSWD|PRIVATE|SERVICE_ROLE|(?<!ALLOW_)CREDENTIAL|SIGNING"
    r"|API_KEY|_KEY(?:_ID)?$|_TOKEN$|ACCESS_TOKEN|AUTH_TOKEN)"
)

#: Broader, and applied only to names that are public by definition. A false
#: positive here is answered by renaming the variable, which costs nothing.
#: PUBLISHABLE and ANON are excused, and only those two: they are the names
#: Supabase gives the key that is public by design and constrained by RLS, and
#: it has to reach the client to work at all.
SECRET_SOUNDING_NAME = re.compile(
    r"(?:SECRET|PRIVATE|PASSWORD|PASSWD|SERVICE_ROLE|TOKEN|(?<!ALLOW_)CREDENTIAL|SIGNING|API_KEY"
    r"|(?<!PUBLISHABLE)(?<!ANON)_KEY$)"
)

#: Names that have no business in app/ AT ALL, prefixed or not. Provider keys
#: and infrastructure: the client reaches these through the Django API, and
#: nothing in app/ - including its server routes - talks to them directly.
#: See CLAUDE.md, "No provider SDK key exists in app/".
NEVER_IN_APP = re.compile(
    r"^(?:OPENAI_|MISTRAL_|PAYMENT_GATEWAY_|DB_|DATABASE_?|MAIL_|SMTP_|REDIS_"
    r"|SUPABASE_JWT|SUPABASE_AUTH|SECRET_KEY$)"
)

#: Names app/ legitimately holds SERVER-side and must never publish.
#:
#: app/ is not a pure client: app.json sets `"web": {"output": "server"}` and
#: src/app/api/**+api.ts are twenty server routes that read Supabase with the
#: service-role key and sign share links - exactly what frontend/ does today and
#: what app/ inherits when it replaces it.
#:
#: So the danger is not naming these, it is PUBLISHING them. Only EXPO_PUBLIC_*
#: is inlined into the bundle; an unprefixed variable stays in the server
#: runtime. Bare is allowed, EXPO_PUBLIC_ is refused.
SERVER_SIDE_IN_APP = re.compile(r"^(?:SUPABASE_SECRET|SUPABASE_SERVICE|SHARE_TOKEN_SECRET$)")


def read_env_example(path: Path) -> list[tuple[int, str, str]]:
    entries = []
    for number, line in enumerate(path.read_text().splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, _, value = stripped.partition("=")
        entries.append((number, name.strip(), value.strip()))
    return entries


# --- reading what git holds ------------------------------------------------


#: Historical blobs that trip a rule and are provably not credentials, keyed by
#: the git object id. Deliberately not keyed by path: a path exemption would
#: also excuse whatever is committed to that path tomorrow, while a blob id
#: names one immutable byte sequence - different content is a different object,
#: and gets no exemption.
KNOWN_BENIGN_BLOBS = {
    "e66b466546e75879686755d4d49a4fbd95ee829f": (
        "tsconfig.tsbuildinfo - TypeScript incremental build state. Its 921 hex "
        "runs are the per-file content fingerprints under `fileInfos`, not keys. "
        "The path is gitignored now, so this blob cannot recur."
    ),
}


def scan_objects(*, reachable_only: bool) -> list[tuple[str, str, str]]:
    """(sha, path, reason) for every blob that looks like it holds a credential.

    `reachable_only` is the difference between "what a fresh clone hands out"
    and "what this checkout still has on disk after a history rewrite".
    """
    names: dict[str, str] = {}
    if reachable_only:
        for line in git("rev-list", "--all", "--objects").splitlines():
            sha, _, path = line.partition(" ")
            if path:
                names[sha] = path
        sized = _batch_check(list(names))
    else:
        sized = [
            (fields[0], fields[1], int(fields[2]))
            for line in git("cat-file", "--batch-all-objects", "--batch-check").splitlines()
            if len(fields := line.split()) == 3 and fields[2].isdigit()
        ]

    # 1 MiB is far above any file that would hold a pasted key, and keeps the
    # scan off the vendored archives that history carries.
    wanted = [sha for sha, kind, size in sized if kind == "blob" and size <= 1_048_576]

    findings = []
    # In chunks: one `git cat-file --batch` for everything would hold the whole
    # scanned history in memory at once.
    stream = (
        pair
        for start in range(0, len(wanted), 200)
        for pair in _batch_read(wanted[start : start + 200])
    )
    for sha, blob in stream:
        if sha in KNOWN_BENIGN_BLOBS:
            continue
        if b"\x00" in blob:
            continue  # binary
        try:
            text = blob.decode("utf-8")
        except UnicodeDecodeError:
            continue
        for reason in dict.fromkeys(secret_findings(text)):
            findings.append((sha, names.get(sha, "<object not on any branch>"), reason))
    return findings


def _run_git_with_input(args: list[str], payload: str) -> bytes:
    # S603: same as git() above - absolute binary, argument vector, no shell.
    proc = subprocess.run(  # noqa: S603
        [GIT, "-C", str(REPO), *args], input=payload.encode(), capture_output=True, check=False
    )
    if proc.returncode != 0:
        pytest.fail(f"git {' '.join(args)} failed: {proc.stderr.decode().strip()}")
    return proc.stdout


def _batch_check(shas: list[str]) -> list[tuple[str, str, int]]:
    if not shas:
        return []
    out = _run_git_with_input(["cat-file", "--batch-check"], "\n".join(shas) + "\n")
    rows = []
    for line in out.decode(errors="replace").splitlines():
        fields = line.split()
        if len(fields) == 3 and fields[2].isdigit():
            rows.append((fields[0], fields[1], int(fields[2])))
    return rows


def _batch_read(shas: list[str]) -> list[tuple[str, bytes]]:
    """`git cat-file --batch` emits `<sha> <type> <size>\\n<size bytes>\\n` per request."""
    if not shas:
        return []
    stream = _run_git_with_input(["cat-file", "--batch"], "\n".join(shas) + "\n")
    blobs = []
    offset = 0
    while offset < len(stream):
        end = stream.find(b"\n", offset)
        if end == -1:
            break
        header = stream[offset:end].split()
        offset = end + 1
        if len(header) != 3 or not header[2].isdigit():
            continue  # "<sha> missing"
        size = int(header[2])
        blobs.append((header[0].decode(), stream[offset : offset + size]))
        offset += size + 1
    return blobs


# --- the audit -------------------------------------------------------------


def test_the_audit_is_not_vacuous():
    # Every check below iterates over discovered files. A restructure that moves
    # or renames them would otherwise turn this whole module into a green no-op,
    # which is worse than not having it.
    assert len(ENV_EXAMPLES) >= 3, f"expected a template per workspace, found {ENV_EXAMPLES}"
    assert (REPO / "app" / ".env.example") in ENV_EXAMPLES
    assert (REPO / "backend" / ".env.example") in ENV_EXAMPLES
    assert DOC.exists(), "the rotation policy this audit reports into has gone"


@pytest.mark.parametrize("path", ENV_EXAMPLES, ids=lambda p: str(p.relative_to(REPO)))
def test_no_env_example_carries_a_filled_in_value(path: Path):
    """A template is tracked, so anything in it is published to everyone with a clone.

    This is how the Google OAuth pair recorded in docs/SECRETS-AND-ROTATION.md
    got out: a working local value typed into `.env.example` instead of `.env`.
    """
    where = path.relative_to(REPO)
    offences = []
    for number, name, value in read_env_example(path):
        if not value:
            continue
        if CREDENTIAL_NAME.search(name):
            offences.append(f"{where}:{number} {name} is named as a credential and has a value")
        elif not is_public_value(value):
            offences.append(f"{where}:{number} {name} has a value that is not a public default")
    assert not offences, "filled-in values in a tracked template:\n  " + "\n  ".join(offences)


def test_no_env_file_is_tracked():
    """The index is the thing that publishes. A file can be ignored and tracked at
    once - git ignores only untracked paths - so being in .gitignore proves nothing
    about a file that was added before the rule was."""
    tracked = [
        line
        for line in git("ls-files").splitlines()
        if (base := line.rsplit("/", 1)[-1]).startswith(".env") and base != ".env.example"
    ]
    assert not tracked, f"env files in the git index: {tracked}"


@pytest.mark.parametrize(
    "workspace", ["", "app", "backend", "frontend", "supabase"], ids=lambda w: w or "<root>"
)
@pytest.mark.parametrize("name", [".env", ".env.local", ".env.production", ".env.development"])
def test_every_real_env_path_is_ignored(workspace: str, name: str):
    """Asks git whether the rule matches, rather than searching .gitignore for text.

    The failure worth catching is a rule that is present and does not apply -
    an anchored `/.env` at the root leaves `app/.env` unprotected, and reading
    the file would show `.env` on a line and conclude everything was fine.
    """
    path = f"{workspace}/{name}" if workspace else name
    matched = git("check-ignore", "-v", "--no-index", path).strip()
    assert matched, f"{path} is not matched by any .gitignore rule"


#: Credential files that carry no `.env` in the name, so the `.env.*` rules do
#: not reach them. Each is a whole credential in one file: a direnv script
#: exports secrets into the shell, a Google service-account JSON *is* a private
#: key, and an SSH key has no extension to match on.
CREDENTIAL_FILENAMES = [
    ".envrc",
    "gcp-service-account.json",
    "id_rsa",
    "id_ed25519",
    "deploy.pfx",
    "server.pem",
    "signing.key",
]


@pytest.mark.parametrize(
    "workspace", ["", "app", "backend", "frontend", "supabase"], ids=lambda w: w or "<root>"
)
@pytest.mark.parametrize("name", CREDENTIAL_FILENAMES)
def test_every_credential_filename_is_ignored(workspace: str, name: str):
    """`.env` is not the only shape a credential arrives in.

    These are the ones that turn up in a repository by accident - dropped in by
    a tool, or downloaded from a provider console into whatever directory the
    browser was pointed at - and none of them is caught by a rule written about
    env files.
    """
    path = f"{workspace}/{name}" if workspace else name
    assert git("check-ignore", "-v", "--no-index", path).strip(), (
        f"{path} is not matched by any .gitignore rule"
    )


def test_the_templates_themselves_are_not_ignored():
    # The negation that re-includes .env.example is what makes the blanket
    # .env.* rule safe. If it stops matching, the templates quietly vanish from
    # the repo and the next contributor invents their own key names.
    for path in ENV_EXAMPLES:
        relative = str(path.relative_to(REPO))
        assert not git("check-ignore", "--no-index", relative).strip(), (
            f"{relative} is ignored - the env templates would drop out of the repo"
        )


def committed_or_stageable() -> list[str]:
    """Every path git would publish: tracked, plus untracked and not ignored.

    `ls-files` alone is the index, and the index is a snapshot of the last
    commit. When work is in progress that is most of the codebase missing - at
    the time this was written 183 files were untracked and 70 tracked paths no
    longer existed on disk, so a scan of the index alone reported a clean tree
    while covering almost none of it. A secret is committed by someone writing
    it and then running `git add`; this audit has to see it before that, not
    after.

    `--exclude-standard` keeps .gitignore honoured, so .env, node_modules and
    .venv stay out - the point is what *would* be published, not what exists.
    """
    return [
        line
        for line in git("ls-files", "--cached", "--others", "--exclude-standard").splitlines()
        if line
    ]


def test_no_credential_literal_in_source():
    """A key pasted into source outlives every rotation of the deployment's env."""
    offences = []
    for relative in committed_or_stageable():
        path = REPO / relative
        if not path.is_file() or path.name.startswith(".env"):
            continue  # templates are audited above, with stricter rules
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # binary or unreadable: no literal to find
        for reason in dict.fromkeys(secret_findings(text)):
            offences.append(f"{relative}: {reason}")
    assert not offences, "credential-shaped literals in source:\n  " + "\n  ".join(offences)


def test_no_credential_literal_in_reachable_git_history():
    """Redacting a committed secret does not unpublish it.

    Anyone who cloned before the redaction still has it, and so does anyone who
    clones after: the old blob is still reachable from the old commit. The fix
    is rotation plus a history rewrite, and this test is what says whether the
    rewrite actually landed.
    """
    hits = scan_objects(reachable_only=True)
    offences = sorted({f"{path}: {reason}" for _, path, reason in hits})
    assert not offences, (
        "credential-shaped literals reachable in git history - rotate first, then rewrite:\n  "
        + "\n  ".join(offences)
    )


def test_lingering_objects_are_accounted_for():
    """A rewritten history leaves the old blobs in the local object store, and on
    a forge they stay fetchable by hash long after they leave every branch.

    The object is not the finding - an unrecorded one is. So this asks the doc to
    ACCOUNT for the incident, in either state: OPEN while the credential is still
    live, ROTATED once it is dead and the blobs are inert.

    Not "is the incident still open". A test that goes red the moment the
    rotation lands would punish finishing the work, and the obvious way to
    silence it would be to delete the record - which is the one outcome worth
    preventing. Passes on a fresh clone, where nothing lingers at all.
    """
    lingering = {sha for sha, _, _ in scan_objects(reachable_only=False)}
    if not lingering:
        return
    doc = DOC.read_text()
    recorded = re.search(r"^\*\*Status:\s*(OPEN|ROTATED)\b", doc, re.MULTILINE | re.IGNORECASE)
    assert recorded, (
        f"{len(lingering)} unreachable object(s) in this checkout's store carry a "
        "credential-shaped literal, and docs/SECRETS-AND-ROTATION.md records no "
        "incident status for them. Add a `**Status: OPEN ...**` line under the "
        "incident heading while the credential is live, or `**Status: ROTATED "
        "<date>**` once it is not. Either is accepted; silence is not."
    )


def test_no_expo_public_variable_is_named_like_a_secret():
    """EXPO_PUBLIC_* is compiled into the bundle. Anyone with the APK can read it.

    The reference project this app is ported from shipped
    EXPO_PUBLIC_GOOGLE_CLIENT_SECRET, which is a client secret handed to every
    installer. The name is the whole check: by the time such a variable exists,
    someone has already decided a secret belongs on the client.
    """
    offences = [
        f"app/.env.example:{number} {name}"
        for number, name, _ in read_env_example(REPO / "app" / ".env.example")
        if name.startswith("EXPO_PUBLIC_") and SECRET_SOUNDING_NAME.search(name)
    ]
    assert not offences, (
        "EXPO_PUBLIC_* names promising a secret into the app bundle:\n  " + "\n  ".join(offences)
    )


def test_the_client_template_declares_no_server_credential():
    """The two templates must not disagree about where a credential lives.

    A key named on both sides gets filled in on both sides, and then rotation
    misses one of them. Everything the server holds is reached over the API.
    """
    backend_credentials = {
        name
        for _, name, _ in read_env_example(REPO / "backend" / ".env.example")
        if CREDENTIAL_NAME.search(name)
    }
    offences = []
    for number, name, _ in read_env_example(REPO / "app" / ".env.example"):
        published = name.startswith("EXPO_PUBLIC_")
        bare = name.removeprefix("EXPO_PUBLIC_")

        if NEVER_IN_APP.match(bare):
            offences.append(f"app/.env.example:{number} {name} belongs in backend/.env.example")
        elif SERVER_SIDE_IN_APP.match(bare):
            # Held by app/'s own server routes. Only publishing it is the fault.
            if published:
                offences.append(
                    f"app/.env.example:{number} {name} is compiled into the app bundle. "
                    f"Drop the EXPO_PUBLIC_ prefix - {bare} is server-side."
                )
        elif bare in backend_credentials:
            offences.append(f"app/.env.example:{number} {name} belongs in backend/.env.example")
    assert not offences, "server-side credentials named in the client template:\n  " + "\n  ".join(
        offences
    )
