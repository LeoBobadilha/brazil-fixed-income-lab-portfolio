"""Mathematical properties of the pricing engine (independent of official data)."""

from datetime import date

import numpy as np
import pytest

from src import calendar_br
from src.pricing import engine
from src.pricing.instruments import PRODUCTS, cashflow_schedule, commercial_year, conversion_date, product_for, security_id
from src.pricing.rounding import round_half_up, trunc

D0 = date(2026, 10, 30)
CASES = [
    ("LTN", date(2032, 1, 1), 15.38),
    ("NTNF", date(2037, 1, 1), 14.5),
    ("LFT", date(2031, 3, 1), 0.08),
    ("NTNBP", date(2035, 5, 15), 7.88),
    ("NTNB", date(2060, 8, 15), 7.4),
    ("RENDA", date(2084, 12, 15), 7.28),
    ("EDUCA", date(2048, 12, 15), 7.5),
]


@pytest.mark.parametrize("code,mat,rate", CASES)
def test_price_decreases_with_yield(code, mat, rate):
    vals = [engine.model_value(code, mat, D0, r) for r in (rate - 1, rate, rate + 1)]
    assert vals[0] > vals[1] > vals[2] > 0


@pytest.mark.parametrize("code,mat,rate", CASES)
def test_duration_matches_finite_difference(code, mat, rate):
    r = engine.risk(code, mat, D0, rate)
    h = 0.0001  # 0.01 bp in % units (central-difference error is O(h^2 * P'''))
    up, dn, mid = (engine.model_value(code, mat, D0, rate + s) for s in (h, -h, 0))
    dP_dy = (up - dn) / (2 * h / 100)
    assert r.modified == pytest.approx(-dP_dy / mid, rel=1e-6)
    assert r.modified > 0 and r.macaulay > r.modified  # positive rates
    assert r.macaulay <= r.years_to_last_flow + 1e-12
    d2 = (up - 2 * mid + dn) / (h / 100) ** 2
    assert r.convexity == pytest.approx(d2 / mid, rel=1e-4)
    assert r.dv01 == pytest.approx(r.modified * mid * 1e-4, rel=1e-12)


@pytest.mark.parametrize("code,mat,rate", CASES)
def test_zero_coupon_macaulay_equals_maturity(code, mat, rate):
    if code not in ("LTN", "LFT", "NTNBP"):
        pytest.skip("coupon bond")
    r = engine.risk(code, mat, D0, rate)
    assert r.macaulay == pytest.approx(r.years_to_last_flow, abs=1e-12)


@pytest.mark.parametrize("code,mat,rate", CASES)
def test_solve_rate_inverts_value(code, mat, rate):
    v = engine.model_value(code, mat, D0, rate)
    assert engine.solve_rate(code, mat, D0, v) == pytest.approx(rate, abs=1e-8)


def test_convexity_improves_duration_approximation():
    code, mat, rate = "RENDA", date(2084, 12, 15), 7.28
    r = engine.risk(code, mat, D0, rate)
    p0 = engine.model_value(code, mat, D0, rate)
    for shock in (-200, -50, 50, 200):
        dy = shock / 1e4
        exact = engine.model_value(code, mat, D0, rate + shock / 100) / p0 - 1
        dur = -r.modified * dy
        dc = dur + 0.5 * r.convexity * dy * dy
        assert abs(dc - exact) < abs(dur - exact)


def test_rounding_helpers():
    assert trunc(0.4166666666, 6) == 0.416666
    assert trunc(-1.23456789, 4) == -1.2345
    assert trunc(416.666 / 1000, 6) == 0.416666
    assert round_half_up(2.5, 0) == 3.0 and round_half_up(-2.5, 0) == -3.0
    assert round_half_up(48.808848, 5) == 48.80885


def test_calendar_holidays_and_law_change():
    assert calendar_br.easter_sunday(2026) == date(2026, 4, 5)
    assert not calendar_br.is_business_day(date(2026, 2, 16))  # Carnival Monday
    assert not calendar_br.is_business_day(date(2026, 6, 4))  # Corpus Christi
    assert not calendar_br.is_business_day(date(2025, 11, 20))  # Consciência Negra (national from 2024)
    assert calendar_br.is_business_day(date(2023, 11, 20))  # before the law
    # pricing done before Lei 14.759 ignores 20-Nov even for future dates
    assert calendar_br.business_days(date(2023, 1, 2), date(2025, 1, 2), asof=date(2023, 1, 2)) == \
        calendar_br.business_days(date(2023, 1, 2), date(2025, 1, 2), asof=date(2024, 1, 2)) + 1


def test_settlement_calendar_rolls_past_closures():
    # 23/12/2025 purchase settles on 26/12 (24 and 25 December are not settlement days)
    assert str(calendar_br.settlement_date(np.datetime64("2025-12-23"), 1)) == "2025-12-26"
    # a price published on a closure day settles on the next settlement day
    assert str(calendar_br.settlement_date(np.datetime64("2025-12-24"), 1)) == "2025-12-26"
    assert str(calendar_br.settlement_date(np.datetime64("2026-10-29"), 1)) == "2026-10-30"


def test_renda_plus_naming_regression():
    """Legacy bug: dataset maturity 2064-12-15 was labelled 'Renda+ 2065'."""
    p = product_for("Tesouro Renda+ Aposentadoria Extra")
    assert commercial_year(p, date(2084, 12, 15)) == 2065
    assert commercial_year(p, date(2064, 12, 15)) == 2045
    assert conversion_date(p, date(2084, 12, 15)) == date(2065, 1, 15)
    sched = cashflow_schedule(p, date(2084, 12, 15))
    assert len(sched) == 240 and sched[0][0] == date(2065, 1, 15) and sched[-1][0] == date(2084, 12, 15)
    assert security_id("RENDA", date(2084, 12, 15)) == "RENDA-20841215"


def test_educa_naming():
    p = PRODUCTS["EDUCA"]
    assert commercial_year(p, date(2030, 12, 15)) == 2026
    assert conversion_date(p, date(2030, 12, 15)) == date(2026, 1, 15)


def test_coupon_schedules():
    ntnb = cashflow_schedule(PRODUCTS["NTNB"], date(2035, 5, 15))
    assert {d.month for d, _, _ in ntnb} == {5, 11} and all(d.day == 15 for d, _, _ in ntnb)
    assert ntnb[-1][1] == pytest.approx(102.956301)
    ntnf = cashflow_schedule(PRODUCTS["NTNF"], date(2037, 1, 1))
    assert {(d.month, d.day) for d, _, _ in ntnf} == {(1, 1), (7, 1)}
    assert ntnf[-1][1] == pytest.approx(1048.80885)


def test_flows_after_settlement_only():
    f = engine.future_flows("NTNB", date(2035, 5, 15), date(2026, 11, 15))
    assert str(f.dates[0]) == "2027-05-15"  # coupon on the settlement date belongs to the seller


def test_unknown_product_raises():
    with pytest.raises(KeyError):
        product_for("Tesouro Imaginário")
