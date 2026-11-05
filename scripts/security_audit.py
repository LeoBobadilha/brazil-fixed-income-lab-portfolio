"""Repository security audit: git history, the built site and the published data.

    python scripts/security_audit.py

Checks, and exits non-zero on any finding:
  1. every text blob ever committed (all refs) for credentials, local drive paths and
     private-network URLs;
  2. git history for files that must never be published (env files, databases, Power BI
     files, backups, private keys);
  3. web/dist (if built) and web/public/data for the same content patterns.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]

CONTENT_PATTERNS = {
    "GitHub token": r"gh[pousr]_[A-Za-z0-9]{20,}",
    "AWS key": r"AKIA[0-9A-Z]{16}",
    "private key": r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    "Slack token": r"xox[baprs]-[A-Za-z0-9-]{10,}",
    "bearer token": r"(?i)authorization:\s*bearer\s+[A-Za-z0-9._-]{20,}",
    # Any absolute local drive path (user profiles, project folders).
    "local file path": r"(?<![A-Za-z0-9])[A-Za-z]:[\\/]{1,2}[A-Za-z][\w .-]*[\\/]",
    # URLs only: minified libraries contain hex tables that look like dotted quads.
    "private network URL": r"(?i)(?:https?|wss?)://(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b",
}
FORBIDDEN_FILES = re.compile(r"(?i)(^|/)(\.env(\..*)?|.*\.(duckdb|db|sqlite3?|pbix|pbit|bak|pem|key|p12|pfx))$")
# Files that legitimately contain the patterns (they define them).
SELF = {"scripts/security_audit.py", "tests/test_public_assets.py", "tests/test_security_audit.py"}
TEXT_SUFFIXES = (".py", ".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".toml", ".yml", ".yaml", ".html", ".css", ".sql", ".txt", ".csv", ".cfg", ".ini", ".sh", ".ps1")

Scanner = Callable[[str, str, bool], list[str]]


def git(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout


def scan_text(label: str, text: str, published_data: bool = False) -> list[str]:
    """Findings for one text. ``published_data`` is part of the scanner signature for extensions."""
    out = []
    for name, pat in CONTENT_PATTERNS.items():
        for m in re.finditer(pat, text):
            ctx = text[max(0, m.start() - 30): m.end() + 30].replace("\n", " ")
            out.append(f"{label}: {name}: ...{ctx}...")
    return out


def audit_history(scanner: Scanner = scan_text, skip: set[str] = SELF) -> tuple[list[str], int]:
    findings: list[str] = []
    objs = git("rev-list", "--all", "--objects").splitlines()
    paths: dict[str, set[str]] = {}
    for line in objs:
        sha, _, path = line.partition(" ")
        if path:
            paths.setdefault(sha, set()).add(path)
            if FORBIDDEN_FILES.search(path):
                findings.append(f"history: forbidden file type committed: {path}")
    blobs = [s for s, ps in paths.items() if any(p.endswith(TEXT_SUFFIXES) for p in ps) and not (ps & skip)]
    proc = subprocess.run(["git", "cat-file", "--batch"], cwd=ROOT, input=("\n".join(blobs) + "\n").encode(), capture_output=True, check=True)
    data, pos = proc.stdout, 0
    for sha in blobs:
        header_end = data.index(b"\n", pos)
        header = data[pos:header_end].decode()
        _, kind, size = header.split()
        body = data[header_end + 1: header_end + 1 + int(size)]
        pos = header_end + 1 + int(size) + 1
        if kind != "blob":
            continue
        path = sorted(paths[sha])[0]
        published = path.startswith("web/public/data/") or path.startswith("tests/fixtures/")
        findings += scanner(f"history {path} ({sha[:8]})", body.decode("utf-8", errors="ignore"), published)
    return findings, len(blobs)


def audit_tree(base: Path, published: bool, scanner: Scanner = scan_text, root: Path = ROOT) -> list[str]:
    out = []
    if not base.exists():
        return out
    for p in base.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if FORBIDDEN_FILES.search(rel):
            out.append(f"{rel}: forbidden file type")
        elif p.suffix in TEXT_SUFFIXES:
            out += scanner(rel, p.read_text(encoding="utf-8", errors="ignore"), published or "/data/" in rel)
    return out


def main() -> int:
    findings, n = audit_history()
    print(f"history: scanned {n} text blobs across all refs")
    findings += audit_tree(ROOT / "web" / "dist", published=False)
    findings += audit_tree(ROOT / "web" / "public" / "data", published=True)
    print("built site and published data: scanned")
    if findings:
        print(f"\n{len(findings)} finding(s):")
        print("\n".join(findings))
        return 1
    print("\nNo findings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
