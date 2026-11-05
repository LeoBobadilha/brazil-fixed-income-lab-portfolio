"""Scenario engine vs independent, hand-computed reference cases (custody, tax, IOF, Renda+)."""

import json
from datetime import date
from pathlib import Path

import pytest

from src.pricing import scenario as S

CASES = json.loads((Path(__file__).parent / "fixtures" / "reference_cases.json").read_text(encoding="utf-8"))["cases"]


def _run(c):
    i = dict(c["input"])
    i["maturity"] = date.fromisoformat(i["maturity"])
    i["valuation_date"] = date.fromisoformat(i["valuation_date"])
    return S.run(S.ScenarioInput(**i))


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_reference_case(case):
    r = _run(case)
    for k, v in case.get("expected", {}).items():
        got = getattr(r, k)
        if isinstance(v, str):
            assert got == v, k
        else:
            assert got == pytest.approx(v, rel=1e-9, abs=1e-9), f"{k}: {got} vs {v} ({case['formula']})"
    for exp in case.get("expected_events", []):
        ev = next(e for e in r.events if e["date"] == exp["date"])
        for k in ("cash", "custody", "income_tax"):
            assert ev[k] == pytest.approx(exp[k], rel=1e-9, abs=1e-9), f"{exp['date']} {k}: {ev[k]} vs {exp[k]} ({case['formula']})"
