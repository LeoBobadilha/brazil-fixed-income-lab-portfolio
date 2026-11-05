"""ETL, data-quality and research logic on small synthetic frames (no network)."""

import json
from datetime import date

import numpy as np
import pandas as pd
import pytest

from src.research import calendar_effects as CE
from src.research import curves
from src.transform.transform_data import build_dim_security, classify_dpf, normalise_tesouro
from src.validate import quality


def raw_rows():
    return pd.DataFrame({
        "Tipo Titulo": ["Tesouro Renda+ Aposentadoria Extra", "Tesouro Prefixado", "Tesouro Prefixado"],
        "Data Vencimento": ["15/12/2084", "01/01/2032", "01/01/2032"],
        "Data Base": ["30/10/2026", "30/10/2026", "29/10/2026"],
        "Taxa Compra Manha": ["7,28", "15,38", "15,30"],
        "Taxa Venda Manha": ["7,40", "15,50", "15,42"],
        "PU Compra Manha": ["178,94", "479,96", "481,00"],
        "PU Venda Manha": ["169,96", "477,14", "478,00"],
        "PU Base Manha": ["169,96", "477,14", "478,00"],
    })


def test_normalise_tesouro_types_and_ids():
    q = normalise_tesouro(raw_rows())
    assert q["buy_rate"].dtype.kind == "f" and q["base_date"].dtype.kind == "M"
    assert q.loc[0, "security_id"] == "RENDA-20841215" and q.loc[1, "security_id"] == "LTN-20320101"
    dim = build_dim_security(q)
    r = dim[dim["security_id"] == "RENDA-20841215"].iloc[0]
    assert r["commercial_year"] == 2065 and r["display_name"].endswith("2065") and r["conversion_date"] == date(2065, 1, 15)
    assert dim["active"].all()


def test_not_offered_side_becomes_null():
    raw = raw_rows()
    raw.loc[0, ["Taxa Compra Manha", "PU Compra Manha"]] = ["0,00", "0,00"]
    q = normalise_tesouro(raw)
    assert pd.isna(q.loc[0, "buy_price"]) and pd.isna(q.loc[0, "buy_rate"])


def test_schema_change_detected(tmp_path):
    from src.transform.transform_data import read_tesouro_raw
    p = tmp_path / "x.csv"
    p.write_text("Tipo Titulo;Data Base\nA;01/01/2020\n", encoding="latin1")
    with pytest.raises(ValueError, match="schema changed"):
        read_tesouro_raw(p)


def test_quality_checks_flag_problems():
    q = normalise_tesouro(raw_rows())
    assert not quality.blocking_failures(quality.check_quotes(q))
    dup = pd.concat([q, q.iloc[[0]]])
    names = [c.name for c in quality.blocking_failures(quality.check_quotes(dup))]
    assert "quotes.unique_security_date" in names
    regress = quality.check_quotes(q, previous={"rows": 10, "max_date": "2027-01-01"})
    names = [c.name for c in quality.blocking_failures(regress)]
    assert "quotes.no_history_loss" in names and "quotes.date_not_regressing" in names
    bad = q.copy()
    bad.loc[0, "buy_rate"] = 55.0
    assert "quotes.real_rate_bounds" in [c.name for c in quality.blocking_failures(quality.check_quotes(bad))]


def test_macro_future_dates_rejected():
    m = pd.DataFrame({"series": ["selic_target"] * 2, "date": pd.to_datetime(["2026-11-01", "2026-12-09"]), "value": [13.75, 13.75]})
    fails = quality.blocking_failures(quality.check_macro(m, pd.Timestamp("2026-11-05")))
    assert [c.name for c in fails] == ["macro.no_future_dates"]


def test_dpf_classification():
    assert classify_dpf("LTN 010127", "Dívida Interna") == "Prefixado"
    assert classify_dpf("NTN-B 150535", "Dívida Interna") == "IPCA"
    assert classify_dpf("LFT 010329", "Dívida Interna") == "Selic"
    assert classify_dpf("GLOBAL 2034", "Dívida Externa") == "Câmbio (dívida externa)"


def test_constant_duration_no_extrapolation():
    panel = pd.DataFrame({"base_date": pd.to_datetime(["2026-01-02"] * 2), "product_code": ["NTNBP", "NTNB"],
                          "macaulay": [3.0, 12.0], "buy_rate": [7.0, 7.9]})
    out = curves.constant_duration(panel, ("NTNBP", "NTNB"), (2.0, 5.0, 10.0, 20.0)).iloc[0]
    assert np.isnan(out["d2y"]) and np.isnan(out["d20y"])
    assert out["d5y"] == pytest.approx(7.0 + 0.9 * 2 / 9)


def test_percentile_requires_enough_observations():
    s = pd.Series(range(100), index=pd.date_range("2020-01-01", periods=100))
    assert curves.percentile_of_last(s)["valid"] is False
    s = pd.Series(np.arange(300.0), index=pd.date_range("2020-01-01", periods=300))
    assert curves.percentile_of_last(s)["percentile"] == pytest.approx(100.0)


def test_holm_adjustment():
    adj = CE.holm([0.01, 0.04, 0.03])
    assert adj == pytest.approx([0.03, 0.06, 0.06])


def test_welch_detects_shift_and_permutation_agrees():
    rng = np.random.default_rng(0)
    a, b = rng.normal(1, 1, 400), rng.normal(0, 1, 400)
    t, p = CE.welch(a, b)
    assert t > 5 and p < 1e-6 and CE.permutation_p(a, b, n=500) < 0.01
    t, p = CE.welch(rng.normal(0, 1, 400), rng.normal(0, 1, 400))
    assert p > 0.001


def test_max_drawdown():
    s = pd.Series([100, 120, 60, 90, 130], index=pd.date_range("2020-01-01", periods=5))
    s = pd.concat([s] * 5).reset_index(drop=True)
    s.index = pd.date_range("2020-01-01", periods=len(s))
    dd = curves.max_drawdown(s)
    assert dd["max_drawdown_pct"] == pytest.approx(-53.846, abs=1e-3)
