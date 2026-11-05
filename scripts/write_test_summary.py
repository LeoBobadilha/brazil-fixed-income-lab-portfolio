"""Summarise JUnit XML reports into web/public/data/tests.json (shown on the Methodology page).

    python scripts/write_test_summary.py reports/pytest.xml web/reports/vitest.xml web/reports/e2e-junit.xml
"""

from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = {"pytest": "Python (pricing, ETL, reconciliation, privacy)", "vitest": "TypeScript (engine parity, UI logic)", "e2e": "Browser (Playwright + axe)"}


def summarise(path: Path) -> dict:
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else root.findall("testsuite")
    tot = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    for s in suites:
        for k in tot:
            tot[k] += int(s.get(k, 0) or 0)
    key = next((k for k in NAMES if k in path.name), path.stem)
    return {"name": NAMES.get(key, key), **tot}


def main(paths: list[str]) -> None:
    rows = [summarise(Path(p)) for p in paths if Path(p).exists()]
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "suites": rows}
    target = ROOT / "web" / "public" / "data" / "tests.json"
    target.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps(out, indent=1))
    if any(r["failures"] or r["errors"] for r in rows):
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
