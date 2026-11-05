"""Structural checks on the GitHub Actions workflows: one deploy path, explicit commits, no duplicates."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

WF = Path(__file__).resolve().parents[1] / ".github" / "workflows"


def load(name: str) -> dict:
    d = yaml.safe_load((WF / name).read_text(encoding="utf-8"))
    d["on"] = d.pop(True, d.get("on"))  # YAML 1.1 parses the key `on` as boolean True
    return d


def test_all_workflows_parse():
    names = sorted(p.name for p in WF.glob("*.yml"))
    assert names == ["ci.yml", "deploy.yml", "refresh.yml", "tests.yml"]
    for n in names:
        assert isinstance(load(n)["jobs"], dict)


def test_deploy_pages_is_used_only_by_the_reusable_deploy_workflow():
    users = [p.name for p in WF.glob("*.yml") if "actions/deploy-pages" in p.read_text(encoding="utf-8")]
    assert users == ["deploy.yml"]
    d = load("deploy.yml")
    assert set(d["on"]) == {"workflow_call"}, "deploy.yml must not run on its own push/dispatch triggers"
    assert d["on"]["workflow_call"]["inputs"]["ref"]["required"] is True


def test_deploy_builds_the_exact_commit_it_was_given():
    text = (WF / "deploy.yml").read_text(encoding="utf-8")
    assert "ref: main" not in text
    steps = load("deploy.yml")["jobs"]["build"]["steps"]
    checkout = [s for s in steps if str(s.get("uses", "")).startswith("actions/checkout")]
    assert checkout and all(s["with"]["ref"] == "${{ inputs.ref }}" for s in checkout)
    assert "heads/main" in text, "deploy must skip commits that are no longer the head of main"


def test_deploy_job_is_serialised_and_verified():
    jobs = load("deploy.yml")["jobs"]
    conc = jobs["deploy"]["concurrency"]
    assert conc["group"] == "github-pages" and conc["cancel-in-progress"] is False
    assert jobs["verify"]["needs"] == "deploy"
    assert "build.json" in str(jobs["verify"]["steps"])


def test_each_caller_tests_and_deploys_the_same_sha():
    ci = load("ci.yml")["jobs"]
    assert ci["tests"]["with"]["ref"] == ci["pages"]["with"]["ref"] == "${{ github.sha }}"
    assert ci["pages"]["needs"] == "tests"
    assert "refs/heads/main" in ci["pages"]["if"] and "pull_request" in ci["pages"]["if"]
    rf = load("refresh.yml")["jobs"]
    assert rf["tests"]["with"]["ref"] == rf["pages"]["with"]["ref"] == "${{ needs.refresh.outputs.sha }}"
    assert set(rf["pages"]["needs"]) == {"refresh", "tests"}
    assert "changed == 'true'" in rf["tests"]["if"]


def test_ci_does_not_run_twice_for_the_same_commit():
    on = load("ci.yml")["on"]
    assert on["push"]["branches"] == ["main"], "branch pushes are tested through their pull request"


def test_reusable_workflows_check_out_their_input_ref():
    for job in load("tests.yml")["jobs"].values():
        co = [s for s in job["steps"] if str(s.get("uses", "")).startswith("actions/checkout")]
        assert co and co[0]["with"]["ref"] == "${{ inputs.ref }}"


def test_actions_are_on_current_major_versions():
    minimum = {"checkout": 7, "setup-python": 7, "setup-node": 7, "upload-artifact": 7, "download-artifact": 8,
               "cache": 6, "deploy-pages": 5, "upload-pages-artifact": 5, "configure-pages": 6}
    for p in WF.glob("*.yml"):
        for name, major in re.findall(r"uses:\s*actions/([\w-]+)@v(\d+)", p.read_text(encoding="utf-8")):
            assert int(major) >= minimum[name], f"{p.name}: actions/{name}@v{major}"


def test_build_info_records_commit_run_and_snapshot():
    import importlib.util

    spec = importlib.util.spec_from_file_location("wbi", WF.parents[1] / "scripts" / "write_build_info.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    env = {"GITHUB_RUN_ID": "42", "GITHUB_REPOSITORY": "o/r", "GITHUB_WORKFLOW": "CI", "GITHUB_RUN_ATTEMPT": "1"}
    info = mod.build_info("abc123", "data", env)
    assert info["commit"] == "abc123" and info["trigger"] == "data"
    assert info["run_url"] == "https://github.com/o/r/actions/runs/42"
    assert info["snapshot_id"] and info["data_as_of"]
