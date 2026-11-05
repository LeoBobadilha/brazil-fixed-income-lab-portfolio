"""Export reference cases from the Python engine for the TypeScript parity tests.

    python scripts/export_golden_vectors.py

Writes web/src/engine/__fixtures__/golden.json. The TypeScript engine must
reproduce every value within the tolerances asserted in engine.test.ts.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from datetime import date, timedelta
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src import calendar_br  # noqa: E402
from src.pricing import engine  # noqa: E402
from src.pricing import scenario as S  # noqa: E402
from src.pricing.instruments import PRODUCTS, cashflow_schedule  # noqa: E402

OUT = ROOT / "web" / "src" / "engine" / "__fixtures__" / "golden.json"


def main() -> None:
    rng = np.random.default_rng(42)
    du = []
    for _ in range(300):
        a = date(2003, 1, 1) + timedelta(days=int(rng.integers(0, 9000)))
        b = a + timedelta(days=int(rng.integers(1, 21900)))
        asof = a if rng.random() < 0.5 else date(2026, 1, 1)
        du.append({"start": str(a), "end": str(b), "asof": str(asof), "du": int(calendar_br.business_days(a, b, asof=asof))})
    settle = []
    for s in ["2025-12-23", "2025-12-24", "2026-10-29", "2026-10-30", "2021-07-08", "2014-06-11", "2026-12-30"]:
        settle.append({"base": s, "d1": str(calendar_br.settlement_date(np.datetime64(s), 1))})
    sched = []
    for code, mat in [("NTNB", "2060-08-15"), ("NTNF", "2037-01-01"), ("RENDA", "2084-12-15"), ("EDUCA", "2048-12-15"), ("LTN", "2032-01-01")]:
        s = cashflow_schedule(PRODUCTS[code], date.fromisoformat(mat))
        sched.append({"code": code, "maturity": mat, "n": len(s), "first": str(s[0][0]), "last": str(s[-1][0]),
                      "sum": sum(x[1] for x in s), "amounts_head": [x[1] for x in s[:3]], "amount_last": s[-1][1]})
    d0 = date(2026, 10, 30)
    cases = [("LTN", "2032-01-01"), ("NTNF", "2037-01-01"), ("LFT", "2031-03-01"), ("NTNBP", "2035-05-15"),
             ("NTNB", "2060-08-15"), ("RENDA", "2084-12-15"), ("EDUCA", "2048-12-15")]
    prices = []
    for code, mat in cases:
        m = date.fromisoformat(mat)
        for rate in ([0.08, 0.5] if code == "LFT" else [5.0, 7.4, 14.0]):
            r = engine.risk(code, m, d0, rate)
            off = engine.price(code, m, d0, rate, vna=None if code in ("LTN", "NTNF") else 4771.175732)
            prices.append({"code": code, "maturity": mat, "settlement": str(d0), "rate": rate, "model_value": r.pv,
                           "macaulay": r.macaulay, "modified": r.modified, "convexity": r.convexity, "dv01": r.dv01,
                           "official_cotacao": off.cotacao, "official_pu": off.pu})
    scen = []
    base = dict(valuation_date=d0)
    inputs = [
        dict(product_code="LTN", maturity=date(2032, 1, 1), buy_price=479.96, buy_rate=15.38, sell_rate=15.5, vna0=None),
        dict(product_code="NTNF", maturity=date(2037, 1, 1), buy_price=812.0, buy_rate=14.5, sell_rate=14.62, vna0=None),
        dict(product_code="NTNBP", maturity=date(2035, 5, 15), buy_price=2509.91, buy_rate=7.88, sell_rate=8.0, vna0=4771.175732),
        dict(product_code="NTNB", maturity=date(2060, 8, 15), buy_price=3980.0, buy_rate=7.4, sell_rate=7.52, vna0=4771.175732),
        dict(product_code="RENDA", maturity=date(2084, 12, 15), buy_price=178.94, buy_rate=7.28, sell_rate=7.4, vna0=4771.175732),
        dict(product_code="RENDA", maturity=date(2049, 12, 15), buy_price=1974.0, buy_rate=7.5, sell_rate=7.62, vna0=4771.175732),
        dict(product_code="LFT", maturity=date(2031, 3, 1), buy_price=20210.0, buy_rate=0.08, sell_rate=0.09, vna0=20200.43),
        dict(product_code="NTNF", maturity=date(2031, 1, 1), buy_price=870.0, buy_rate=14.3, sell_rate=14.42, vna0=None),
        dict(product_code="EDUCA", maturity=date(2048, 12, 15), buy_price=1180.0, buy_rate=7.31, sell_rate=7.43, vna0=4771.175732),
    ]
    for inp in inputs:
        for horizon, shock, costs, taxes, amount in [(0.5, -100, True, True, 10_000), (3, 50, True, True, 50_000),
                                                      (40, 0, True, True, 10_000), (10 / 365.25, -300, True, True, 10_000),
                                                      (2, 0, False, False, 10_000)]:
            si = S.ScenarioInput(**base, **inp, amount=amount, horizon_years=horizon, shock_bp=shock, inflation_pa=4.5,
                                 selic_pa=12.5, reinvest_pa=11.0, apply_costs=costs, apply_taxes=taxes)
            r = S.run(si)
            d = asdict(r)
            d.pop("events")
            scen.append({"input": {k: (str(v) if isinstance(v, date) else v) for k, v in asdict(si).items()}, "result": d,
                         "n_events": len(r.events)})
    # Scenarios initialised on historical dates (before the 20-November holiday law)
    for d_hist, inp in [(date(2022, 9, 22), dict(product_code="NTNB", maturity=date(2035, 5, 15), buy_price=4029.0, buy_rate=5.95, sell_rate=6.07, vna0=3955.779249)),
                        (date(2015, 3, 2), dict(product_code="LTN", maturity=date(2018, 1, 1), buy_price=720.0, buy_rate=13.2, sell_rate=13.26, vna0=None))]:
        for horizon, shock in [(1, 50), (2.5, -100)]:
            si = S.ScenarioInput(valuation_date=d_hist, **inp, amount=25_000, horizon_years=horizon, shock_bp=shock, inflation_pa=4.5,
                                 selic_pa=12.5, reinvest_pa=11.0)
            r = S.run(si)
            d = asdict(r)
            d.pop("events")
            scen.append({"input": {k: (str(v) if isinstance(v, date) else v) for k, v in asdict(si).items()}, "result": d, "n_events": len(r.events)})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"_generated_by": "scripts/export_golden_vectors.py", "du": du, "settlement": settle,
                               "schedules": sched, "prices": prices, "scenarios": scen}, indent=1), encoding="utf-8")
    print(f"wrote {OUT} ({len(du)} du, {len(prices)} prices, {len(scen)} scenarios)")


if __name__ == "__main__":
    main()
