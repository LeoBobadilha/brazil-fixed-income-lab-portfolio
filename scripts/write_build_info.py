"""Write web/public/data/build.json: which commit and data snapshot a deployed site was built from.

    python scripts/write_build_info.py --commit <sha> --trigger code|data|manual

Used by .github/workflows/deploy.yml. The verify job reads build.json from the live site and
checks that its commit equals the commit the workflow set out to deploy. build.json is not
committed; local builds simply have no build record.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"


def build_info(commit: str, trigger: str, env: dict[str, str] | None = None) -> dict:
    env = dict(os.environ if env is None else env)
    manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    run_id = env.get("GITHUB_RUN_ID")
    repo = env.get("GITHUB_REPOSITORY")
    server = env.get("GITHUB_SERVER_URL", "https://github.com")
    return {
        "commit": commit,
        "trigger": trigger,
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "workflow": env.get("GITHUB_WORKFLOW"),
        "run_id": run_id,
        "run_attempt": env.get("GITHUB_RUN_ATTEMPT"),
        "run_url": f"{server}/{repo}/actions/runs/{run_id}" if run_id and repo else None,
        "snapshot_id": manifest.get("snapshot_id"),
        "data_as_of": manifest.get("data_as_of"),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", required=True)
    ap.add_argument("--trigger", default="code", choices=["code", "data", "manual"])
    a = ap.parse_args()
    info = build_info(a.commit, a.trigger)
    (DATA / "build.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    print(json.dumps(info, indent=1))


if __name__ == "__main__":
    main()
