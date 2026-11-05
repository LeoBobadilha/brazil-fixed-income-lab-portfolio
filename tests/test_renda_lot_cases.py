"""The independent Renda+ lot cases use the official income-tax table and are up to date."""

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "renda_lot_cases.json"
ASSUMPTIONS = ROOT / "config" / "assumptions" / "br_costs_taxes_v2026-11.json"


def _generator():
    spec = importlib.util.spec_from_file_location("lots", ROOT / "scripts" / "make_renda_lot_cases.py")
    mod = importlib.util.module_from_spec(spec)
    # Load the functions without writing the fixture: execute only up to the case list.
    src = (ROOT / "scripts" / "make_renda_lot_cases.py").read_text(encoding="utf-8").split("cases = []")[0]
    exec(compile(src, "make_renda_lot_cases.py", "exec"), mod.__dict__)
    return mod


def test_generator_table_matches_the_versioned_assumptions():
    table = json.loads(ASSUMPTIONS.read_text(encoding="utf-8"))["income_tax"]["regressive_table"]
    bracket = _generator().bracket

    def official(days: int) -> float:
        return next(r["rate"] for r in table if r["max_days"] is None or days <= r["max_days"])

    for days in [1, 30, 179, 180, 181, 359, 360, 361, 719, 720, 721, 5000]:
        assert bracket(days) == official(days), days


def test_fixture_covers_the_required_situations():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    rates = {lot["rate"] for c in data["cases"] for lot in c["expected"]["lots"]}
    assert rates == {0.225, 0.2, 0.175, 0.15}
    ages = {lot["age_days"] for c in data["cases"] for lot in c["expected"]["lots"]}
    assert {180, 181, 360, 361, 720, 721} <= ages
    custody = [c["expected"]["custody"] for c in data["cases"]]
    assert any(v == 0 for v in custody) and any(v > 0 for v in custody)
    assert any(c["input"]["pay_day"].startswith("2065") for c in data["cases"])
    assert any(c["input"]["pay_day"].startswith("2030") for c in data["cases"])
    assert data["guards"][0]["id"].startswith("G1")


def test_per_lot_arithmetic_is_internally_consistent():
    for c in json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]:
        e = c["expected"]
        assert abs(sum(lot["income_tax"] for lot in e["lots"]) - e["income_tax"]) < 1e-9
        assert abs(e["gross"] - e["income_tax"] - e["custody"] - e["net"]) < 1e-9
