"""Reconciliation with Tesouro Nacional's published worked examples.

Expected values come verbatim from tests/fixtures/official_examples.json and
must never be edited to make the engine pass.
"""

from datetime import date, timedelta

import json
from pathlib import Path

import numpy as np
import pytest

from src import calendar_br
from src.pricing import engine
from src.pricing.instruments import NTNB_COUPON, NTNF_COUPON, PRODUCTS, amortisation_rates, cashflow_schedule
from src.pricing.rounding import trunc
from src.pricing.vna import project_ipca_vna, project_selic_vna, vni_from_index

FX = json.loads((Path(__file__).parent / "fixtures" / "official_examples.json").read_text(encoding="utf-8"))


def d(s: str) -> date:
    return date.fromisoformat(s)


def test_coupon_constants():
    assert NTNB_COUPON == pytest.approx(2.956301, abs=0)
    assert NTNF_COUPON == pytest.approx(48.80885, abs=0)


def test_ltn_example():
    ex = FX["ltn"]
    assert calendar_br.business_days(d(ex["settlement"]), d(ex["maturity"])) == ex["du"]
    res = engine.price("LTN", d(ex["maturity"]), d(ex["settlement"]), ex["rate"])
    assert res.pu == pytest.approx(ex["pu"], abs=1e-9)


def test_ntnf_example_flows_and_price():
    ex = FX["ntnf"]
    f = engine.future_flows("NTNF", d(ex["maturity"]), d(ex["settlement"]))
    assert [str(x) for x in f.dates] == [row[0] for row in ex["flows"]]
    assert list(f.du.astype(int)) == [row[3] for row in ex["flows"]]
    assert list(f.amounts) == pytest.approx([row[1] for row in ex["flows"]], abs=0)
    res = engine.price("NTNF", d(ex["maturity"]), d(ex["settlement"]), ex["rate"])
    assert res.pu == pytest.approx(ex["pu"], abs=1e-9)


def test_lft_example():
    ex = FX["lft"]
    assert calendar_br.business_days(d(ex["settlement"]), d(ex["maturity"])) == ex["du"]
    vna_proj = project_selic_vna(ex["vna_20080520"], ex["selic_meta"], business_days=1)
    assert vna_proj == pytest.approx(ex["vna_proj"], abs=1e-9)
    res = engine.price("LFT", d(ex["maturity"]), d(ex["settlement"]), ex["rate"], vna=vna_proj)
    assert res.cotacao == pytest.approx(ex["cotacao"], abs=1e-12)
    assert res.pu == pytest.approx(ex["pu"], abs=1e-9)


def test_ntnb_example():
    ex = FX["ntnb"]
    f = engine.future_flows("NTNB", d(ex["maturity"]), d(ex["settlement"]))
    assert list(f.du.astype(int)) == [row[3] for row in ex["flows"]]
    vna_proj = project_ipca_vna(ex["vna_15"], ex["ipca_proj"], d(ex["settlement"]))
    assert vna_proj == pytest.approx(ex["vna_proj"], abs=1e-9)
    res = engine.price("NTNB", d(ex["maturity"]), d(ex["settlement"]), ex["rate"], vna=vna_proj)
    assert res.cotacao == pytest.approx(ex["cotacao"], abs=1e-12)
    assert res.pu == pytest.approx(ex["pu"], abs=1e-9)


def test_ntnb_coupon_payment():
    ex = FX["ntnb_coupon"]
    assert trunc(ex["vna"] * NTNB_COUPON / 100, 6) == pytest.approx(ex["coupon"], abs=1e-9)


@pytest.mark.parametrize("key,code,n", [("renda2030", "RENDA", 240), ("educa2030", "EDUCA", 60)])
def test_ntnb1_schedule_and_du_table(key, code, n):
    ex = FX[key]
    sched = cashflow_schedule(PRODUCTS[code], d(ex["maturity"]))
    assert len(sched) == n
    assert sched[0][0] == d(ex["conversion"])
    assert sched[-1][0] == d(ex["maturity"])
    assert [str(s[0]) for s in sched] == [r["date"] for r in ex["table"]]
    assert [s[1] for s in sched] == [r["amount"] for r in ex["table"]]
    assert sum(s[1] for s in sched) == pytest.approx(100.0, abs=1e-9)
    f = engine.future_flows(code, d(ex["maturity"]), d(ex["settlement"]))
    # All published DU values (240 for Renda+, 60 for Educa+) must match: this
    # validates the holiday calendar including Consciência Negra from 2024.
    assert list(f.du.astype(int)) == [r["du"] for r in ex["table"]]


def test_renda_2030_full_price():
    ex = FX["renda2030"]
    vni = vni_from_index(ex["ipca_index_aug2022"], ex["ipca_index_jun2000"])
    assert vni == pytest.approx(ex["vni"], abs=1e-9)
    vni_proj = project_ipca_vna(vni, ex["ipca_proj"], d(ex["settlement"]))
    assert vni_proj == pytest.approx(ex["vni_proj"], abs=1e-9)
    res = engine.price("RENDA", d(ex["maturity"]), d(ex["settlement"]), ex["rate"], vna=vni_proj)
    assert res.cotacao == pytest.approx(ex["cotacao"], abs=1e-12)
    assert res.pu_td == pytest.approx(ex["pu_td"], abs=1e-9)


def test_educa_2030_full_price():
    ex = FX["educa2030"]
    vni_proj = project_ipca_vna(ex["vni"], ex["ipca_proj"], d(ex["settlement"]))
    assert vni_proj == pytest.approx(ex["vni_proj"], abs=1e-9)
    res = engine.price("EDUCA", d(ex["maturity"]), d(ex["settlement"]), ex["rate"], vna=vni_proj)
    assert res.pu_td == pytest.approx(ex["pu_td"], abs=1e-9)


def test_amortisation_rates_truncation_rule():
    r240 = amortisation_rates(240)
    assert r240[0] == 0.416666 and r240[-1] == pytest.approx(0.416826, abs=1e-12)
    r60 = amortisation_rates(60)
    assert r60[0] == 1.666666 and r60[-1] == pytest.approx(1.666706, abs=1e-12)
