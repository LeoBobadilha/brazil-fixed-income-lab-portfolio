"""Controlled tests of the data-refresh path: what is committed, and what survives a failure.

The commit tests run the real shell step from .github/workflows/refresh.yml in a throwaway
Git repository with a local bare remote, so they cannot drift from the workflow. They exercise
the changed-data logic without creating any production data update.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd
import pytest

yaml = pytest.importorskip("yaml")

ROOT = Path(__file__).resolve().parents[1]
REFRESH = ROOT / ".github" / "workflows" / "refresh.yml"


def _bash() -> str | None:
    if os.name != "nt":
        return shutil.which("bash")
    git = shutil.which("git")  # Git for Windows ships bash; System32 bash is WSL
    if not git:
        return None
    found = [p / "bin" / "bash.exe" for p in Path(git).resolve().parents if (p / "bin" / "bash.exe").exists()]
    return str(found[0]) if found else None


BASH = _bash()


def _steps() -> list[dict]:
    return yaml.safe_load(REFRESH.read_text(encoding="utf-8"))["jobs"]["refresh"]["steps"]


def _commit_step() -> dict:
    return next(s for s in _steps() if s.get("id") == "commit")


def _git(cwd: Path, *args: str) -> str:
    cmd = ["git", "-c", "user.name=test", "-c", "user.email=test@example.invalid", *args]
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repo(tmp_path):
    remote = tmp_path / "remote.git"
    work = tmp_path / "work"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    subprocess.run(["git", "clone", "-q", str(remote), str(work)], check=True, capture_output=True)
    (work / "web" / "public" / "data").mkdir(parents=True)
    (work / "web" / "public" / "data" / "latest.json").write_text('{"date": "2026-10-30"}', encoding="utf-8")
    (work / "README.md").write_text("project", encoding="utf-8")
    (work / ".gitignore").write_text("reports/\n", encoding="utf-8")
    _git(work, "add", "-A")
    _git(work, "commit", "-q", "-m", "initial")
    _git(work, "branch", "-M", "main")
    _git(work, "push", "-q", "-u", "origin", "main")
    (work / "reports").mkdir()
    return SimpleNamespace(work=work, remote=remote, tmp=tmp_path)


def _run_commit_step(repo, changed: bool) -> dict[str, str]:
    report = {"data_as_of": "2026-11-04", "snapshot_id": "abc", "changed": changed, "status": {"status": "current"}}
    (repo.work / "reports" / "last_run.json").write_text(json.dumps(report), encoding="utf-8")
    script = repo.tmp / "commit_step.sh"
    with script.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write("set -e\n" + _commit_step()["run"])
    out = repo.tmp / "github_output"
    out.write_text("", encoding="utf-8")
    env = {**os.environ, "GITHUB_OUTPUT": out.as_posix()}
    subprocess.run([BASH, script.as_posix()], cwd=repo.work, check=True, env=env, capture_output=True)
    return dict(line.split("=", 1) for line in out.read_text(encoding="utf-8").splitlines() if "=" in line)


needs_bash = pytest.mark.skipif(BASH is None, reason="bash not available")


@needs_bash
def test_changed_snapshot_commits_only_data_and_reports_the_new_commit(repo):
    head_before = _git(repo.work, "rev-parse", "HEAD")
    (repo.work / "web" / "public" / "data" / "latest.json").write_text('{"date": "2026-11-04"}', encoding="utf-8")
    (repo.work / "README.md").write_text("unrelated local change", encoding="utf-8")
    out = _run_commit_step(repo, changed=True)
    head = _git(repo.work, "rev-parse", "HEAD")
    assert head != head_before
    assert out == {"changed": "true", "sha": head}
    assert _git(repo.work, "show", "--name-only", "--format=", head).split() == ["web/public/data/latest.json"]
    assert _git(repo.work, "log", "-1", "--format=%s") == "data: refresh snapshot (data as of 2026-11-04)"
    assert _git(repo.work, "log", "-1", "--format=%ae").endswith("users.noreply.github.com")
    assert _git(repo.remote, "rev-parse", "main") == head, "the commit must reach the remote"


@needs_bash
def test_unchanged_snapshot_commits_nothing(repo):
    head_before = _git(repo.work, "rev-parse", "HEAD")
    out = _run_commit_step(repo, changed=False)
    assert out == {"changed": "false"}
    assert _git(repo.work, "rev-parse", "HEAD") == head_before
    assert _git(repo.remote, "rev-parse", "main") == head_before


@needs_bash
def test_metadata_only_difference_with_same_snapshot_commits_nothing(repo):
    head_before = _git(repo.work, "rev-parse", "HEAD")
    (repo.work / "web" / "public" / "data" / "latest.json").write_text('{"date": "2026-10-30", "built": "later"}', encoding="utf-8")
    out = _run_commit_step(repo, changed=False)
    assert out == {"changed": "false"}
    assert _git(repo.work, "rev-parse", "HEAD") == head_before


def test_a_failed_pipeline_stops_the_job_before_any_commit():
    steps = _steps()
    names = [s.get("name", s.get("uses", "")) for s in steps]
    pipeline = next(i for i, n in enumerate(names) if n.startswith("Run pipeline"))
    tests = next(i for i, n in enumerate(names) if n.startswith("Tests on the new snapshot"))
    commit = next(i for i, s in enumerate(steps) if s.get("id") == "commit")
    assert pipeline < tests < commit
    # Without an `if:` a step is skipped after a failure, so nothing is committed or pushed.
    for i in (pipeline, tests, commit):
        assert "if" not in steps[i]
    assert "continue-on-error" not in str(steps)


def test_blocking_quality_failure_exits_non_zero_without_publishing(monkeypatch, tmp_path):
    from src import pipeline as P

    quotes = pd.DataFrame({"base_date": pd.to_datetime(["2026-10-30"]), "product_name": ["x"]})
    published = MagicMock()
    quality = MagicMock()
    quality.check_quotes.return_value = []
    quality.check_macro.return_value = []
    quality.check_reconciliation.return_value = []
    quality.as_records.return_value = [{"name": "duplicate_keys", "passed": False}]
    quality.blocking_failures.return_value = [SimpleNamespace(name="duplicate_keys")]
    monkeypatch.setattr(P, "download", lambda: {})
    monkeypatch.setattr(P, "transform_data", lambda: {k: quotes for k in ("quotes", "dim_security", "macro", "ipca_index", "focus", "dpf")})
    monkeypatch.setattr(P, "_previous_snapshot", lambda: {"snapshot_id": "previous"})
    monkeypatch.setattr(P, "quality", quality)
    reconcile = MagicMock()
    reconcile.reconcile.return_value = (quotes, quotes)
    monkeypatch.setattr(P, "R", reconcile)
    monkeypatch.setattr(P, "create_fact_cashflows", lambda _d: quotes)
    monkeypatch.setattr(P, "load_database", lambda _t: None)
    monkeypatch.setattr(P, "publish", published)
    monkeypatch.setattr(P, "REPORTS_DIR", tmp_path)
    with pytest.raises(SystemExit) as e:
        P.run_pipeline()
    assert e.value.code == 2
    published.assert_not_called()
    report = json.loads((tmp_path / "last_run.json").read_text(encoding="utf-8"))
    assert report["published"] is False and report["blocking_failures"] == ["duplicate_keys"]


def test_failure_during_publish_leaves_the_last_snapshot_intact(monkeypatch, tmp_path):
    from src.publish import web_datasets as W

    out = tmp_path / "data"
    out.mkdir()
    (out / "latest.json").write_text('{"snapshot": "last good"}', encoding="utf-8")

    def boom(*_a, **_k):
        raise RuntimeError("simulated failure while building datasets")

    monkeypatch.setattr(W, "build_securities", lambda _d: [])
    monkeypatch.setattr(W, "build_latest", boom)
    tables = {k: MagicMock() for k in ("fact_quotes", "dim_security", "fact_risk", "vna_daily")}
    with pytest.raises(RuntimeError):
        W.publish(tables, {}, [], {}, {}, out_dir=out)
    assert (out / "latest.json").read_text(encoding="utf-8") == '{"snapshot": "last good"}'
    assert [p.name for p in out.iterdir()] == ["latest.json"]
