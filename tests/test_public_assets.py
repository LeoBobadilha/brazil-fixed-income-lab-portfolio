"""Public-asset audit: published datasets are well-formed and contain no private data.

Runs against web/public/data when a snapshot exists (CI builds one first).
"""

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"
has_snapshot = (DATA / "manifest.json").exists()

# Local drive paths (user profiles, project folders) and credentials must never appear in any public file.
FORBIDDEN_ANYWHERE = [r"(?<![A-Za-z0-9])[A-Za-z]:[\\/]{1,2}[A-Za-z][\w .-]*[\\/]", r"gh[pousr]_[A-Za-z0-9]{10,}", r"AKIA[0-9A-Z]{16}", r"-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"]
SCAN_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".json", ".md", ".toml", ".yml", ".yaml", ".html", ".css", ".sql", ".txt"}
SKIP_TOP = {".git", ".venv", "data", "logs", "exports", "reports"}  # local-only folders (git-ignored)
SKIP_ANY = {"node_modules", "dist", "test-results", "playwright-report"}


def _public_files():
    for p in ROOT.rglob("*"):
        if not p.is_file() or p.suffix not in SCAN_SUFFIXES or p.name == "test_public_assets.py":
            continue
        parts = p.relative_to(ROOT).parts
        if parts[0] in SKIP_TOP or set(parts) & SKIP_ANY:
            continue
        yield p


def test_no_local_paths_or_credentials_in_repository_files():
    hits = []
    for p in _public_files():
        text = p.read_text(encoding="utf-8", errors="ignore")
        for pat in FORBIDDEN_ANYWHERE:
            for m in re.finditer(pat, text):
                ctx = text[max(0, m.start() - 40): m.end() + 40].replace("\n", " ")
                hits.append(f"{p.relative_to(ROOT)}: {pat} -> ...{ctx}...")
    assert not hits, "\n".join(hits)


@pytest.mark.skipif(not has_snapshot, reason="no published snapshot")
def test_manifest_and_files():
    m = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    assert m["schema_version"] == 1 and m["status"] in ("current", "stale")
    for name in m["files"]:
        assert (DATA / name).exists(), name
    assert len(list((DATA / "history").glob("*.json"))) == m["history_files"] == m["counts"]["securities"]
    assert all(v["licence"] for v in m["licences"].values())


@pytest.mark.skipif(not has_snapshot, reason="no published snapshot")
def test_latest_dataset_consistency():
    latest = json.loads((DATA / "latest.json").read_text(encoding="utf-8"))
    secs = {s["id"]: s for s in json.loads((DATA / "securities.json").read_text(encoding="utf-8"))}
    assert latest["rows"], "no active securities"
    for r in latest["rows"]:
        s = secs[r["id"]]
        assert s["active"]
        if r.get("buy_price") and r.get("sell_price"):
            assert r["spread_bp"] is None or r["spread_bp"] >= -1
        if s["modelled"] and r.get("modified") is not None:
            assert 0 < r["modified"] < 80
    renda = [s for s in secs.values() if s["code"] == "RENDA" and s["maturity"] == "2084-12-15"]
    assert renda and renda[0]["year"] == 2065 and renda[0]["conversion"] == "2065-01-15"


@pytest.mark.skipif(not has_snapshot, reason="no published snapshot")
def test_no_future_macro_observations():
    m = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    macro = json.loads((DATA / "macro.json").read_text(encoding="utf-8"))
    gen = m["generated_at"][:10]
    for k, s in macro["series"].items():
        assert max(s["dates"]) <= gen, k
