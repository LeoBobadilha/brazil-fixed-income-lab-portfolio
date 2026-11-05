"""Scenario engine consistency: costs/taxes, hold-to-maturity identities, no double deduction."""

from dataclasses import replace
from datetime import date

import pytest

from src.pricing import scenario as S

D0 = date(2026, 10, 30)


def ltn(**kw):
    base = S.ScenarioInput(product_code="LTN", maturity=date(2032, 1, 1), valuation_date=D0, buy_price=479.96,
                           buy_rate=15.38, sell_rate=15.50, vna0=None, amount=10_000, horizon_years=10,
                           apply_costs=False, apply_taxes=False)
    return replace(base, **kw)


def test_ltn_held_to_maturity_earns_contracted_rate_gross():
    r = S.run(ltn())
    assert r.held_to_maturity
    units = 10_000 / 479.96
    assert r.gross_value == pytest.approx(units * 1000, rel=1e-12)
    assert r.net_value == pytest.approx(r.gross_value, rel=1e-12)
    assert r.sale_proceeds == 0 and r.exit_price is None


def test_taxes_and_custody_reduce_value_exactly_once():
    gross = S.run(ltn(apply_costs=False, apply_taxes=False))
    cost = S.run(ltn(apply_costs=True, apply_taxes=False))
    full = S.run(ltn(apply_costs=True, apply_taxes=True))
    assert cost.net_value == pytest.approx(gross.net_value - cost.custody, rel=1e-12)
    assert full.net_value == pytest.approx(gross.net_value - full.custody - full.income_tax - full.iof, rel=1e-12)
    # Default (assumptions 2026-11.2): custody NOT deducted from the tax base,
    # because that treatment is unconfirmed; the alternative is a sensitivity.
    gain = gross.gross_value - 10_000
    assert full.custody_deductible is False
    assert full.income_tax == pytest.approx(0.15 * gain, rel=1e-9)
    alt = S.run(ltn(apply_costs=True, apply_taxes=True, custody_deductible=True))
    assert alt.income_tax == pytest.approx(0.15 * (gain - alt.custody), rel=1e-9)
    assert alt.custody == pytest.approx(full.custody, rel=1e-12)


def test_rate_shock_sign_on_early_sale():
    up = S.run(ltn(horizon_years=2, shock_bp=200))
    flat = S.run(ltn(horizon_years=2, shock_bp=0))
    dn = S.run(ltn(horizon_years=2, shock_bp=-200))
    assert dn.gross_value > flat.gross_value > up.gross_value


def test_short_holding_iof_and_highest_ir_bracket():
    r = S.run(ltn(horizon_years=10 / 365.25, shock_bp=-300, apply_taxes=True))
    assert r.iof > 0
    gain = r.sale_proceeds - 10_000
    assert r.income_tax == pytest.approx(0.225 * (gain - r.iof), rel=1e-9)


def test_ir_and_iof_tables():
    a = S.load_assumptions()
    assert [S.ir_rate(d, a) for d in (1, 180, 181, 360, 361, 720, 721)] == [0.225, 0.225, 0.20, 0.20, 0.175, 0.175, 0.15]
    assert S.iof_share(1, a) == 0.96 and S.iof_share(29, a) == 0.03 and S.iof_share(30, a) == 0.0


def test_selic_custody_exemption():
    base = S.ScenarioInput(product_code="LFT", maturity=date(2031, 3, 1), valuation_date=D0, buy_price=20210.0,
                           buy_rate=0.08, sell_rate=0.09, vna0=20200.0, amount=8_000, horizon_years=2,
                           apply_costs=True, apply_taxes=False, selic_pa=12.0)
    small = S.run(base)
    assert small.custody == pytest.approx(0.0, abs=1e-9)  # below R$10k exemption
    big = S.run(replace(base, amount=50_000))
    assert big.custody > 0


def test_renda_plus_payments_and_pro_rata_cost():
    inp = S.ScenarioInput(product_code="RENDA", maturity=date(2049, 12, 15), valuation_date=D0, buy_price=1974.0,
                          buy_rate=7.5, sell_rate=7.62, vna0=4771.18, amount=10_000, horizon_years=30,
                          inflation_pa=4.0, reinvest_pa=0.0, apply_costs=False, apply_taxes=True)
    r = S.run(inp)
    assert r.held_to_maturity and len(r.events) == 240
    assert r.events[0]["date"] == "2030-01-15" and r.events[-1]["date"] == "2049-12-15"
    units = 10_000 / 1974.0
    first = r.events[0]
    expected_vna = 4771.18 * 1.04 ** ((date(2030, 1, 15) - D0).days / 365.25)
    assert first["cash"] == pytest.approx(units * expected_vna * 0.416666 / 100, rel=1e-12)
    # cost basis returned pro rata: tax only on the gain part of each payment
    assert first["income_tax"] == pytest.approx(0.15 * (first["cash"] - 10_000 * 0.416666 / 100), rel=1e-9)


def test_instant_shock_approximations():
    out = S.instant_shock("NTNBP", date(2035, 5, 15), D0, 7.88, 100, 4771.18)
    assert out["exact_pct"] < 0
    assert abs(out["duration_convexity_pct"] - out["exact_pct"]) < abs(out["duration_pct"] - out["exact_pct"])


# --- Sprint 7: custody timing, NTN-B1 rules, threshold cases -------------------

def ntnf(**kw):
    base = S.ScenarioInput(product_code="NTNF", maturity=date(2031, 1, 1), valuation_date=D0, buy_price=870.0,
                           buy_rate=14.3, sell_rate=14.42, vna0=None, amount=100_000, horizon_years=10,
                           apply_costs=True, apply_taxes=False, reinvest_pa=0.0)
    return replace(base, **kw)


def test_custody_is_collected_at_every_coupon():
    r = S.run(ntnf())
    coupons = [e for e in r.events if e["kind"] == "coupon"]
    assert len(coupons) == 8  # 1 Jan / 1 Jul 2027-2030
    assert all(e["custody"] > 0 for e in r.events), "every coupon and the final payment carry accrued custody"
    # ~0.20% p.a. of a ~R$ 100k position: each half-year collects about R$ 100.
    for e in coupons[1:]:
        assert 80 < e["custody"] < 120
    # No custody remains to be collected at a sale because the bond was held to maturity.
    assert r.custody_at_sale == 0.0
    assert r.custody == pytest.approx(sum(e["custody"] for e in r.events), rel=1e-12)


def test_custody_deducted_exactly_once_with_coupons():
    gross = S.run(ntnf(apply_costs=False))
    net = S.run(ntnf())
    # reinvest_pa = 0, so the net value differs from the gross value by the custody only
    assert net.net_value == pytest.approx(gross.net_value - net.custody, rel=1e-12)


def test_early_sale_collects_only_unpaid_accrual():
    r = S.run(ntnf(horizon_years=1.25, shock_bp=0))
    paid = sum(e["custody"] for e in r.events)
    total_days = (date.fromisoformat(r.horizon_date) - D0).days
    approx_total = 0.002 * total_days / 365 * 100_000
    assert r.custody == pytest.approx(paid + r.custody_at_sale, rel=1e-12)
    assert r.custody == pytest.approx(approx_total, rel=0.08)  # value drifts around the 100k invested


def renda(**kw):
    base = S.ScenarioInput(product_code="RENDA", maturity=date(2049, 12, 15), valuation_date=D0, buy_price=1974.0,
                           buy_rate=7.5, sell_rate=7.62, vna0=4771.18, amount=10_000, horizon_years=5,
                           inflation_pa=4.0, reinvest_pa=0.0, apply_costs=True, apply_taxes=False)
    return replace(base, **kw)


@pytest.mark.parametrize("years,rate", [(5, 0.005), (9.9, 0.005), (10.5, 0.002), (19, 0.002), (21, 0.001)])
def test_renda_early_redemption_tiers(years, rate):
    r = S.run(renda(maturity=date(2084, 12, 15), buy_price=178.94, buy_rate=7.28, sell_rate=7.40, horizon_years=years))
    assert not r.held_to_maturity
    # Years held run from the purchase settlement (D+1) to the sale settlement (D+0 since 2021):
    # 30/10/2026 is a Friday and 02/11/2026 (Finados) a holiday, so the purchase settles on 03/11/2026.
    assert r.purchase_settlement == "2026-11-03"
    assert r.tax_holding_days == (date.fromisoformat(r.horizon_date) - date(2026, 11, 3)).days
    yrs = r.tax_holding_days / 365.0
    assert r.custody_at_sale == pytest.approx(rate * yrs * r.sale_proceeds, rel=1e-12)


def test_renda_income_threshold_below_at_above():
    a = S.load_assumptions()
    mw = a["custody"]["minimum_wage_brl"]
    # Choose amounts so the first instalment is below / at / above 6 minimum wages (MW indexed to IPCA).
    first = date(2030, 1, 15)
    vna_first = 4771.18 * 1.04 ** ((first - D0).days / 365.25)
    mw_first = mw * 1.04 ** ((first - D0).days / 365.25)
    per_unit = vna_first * 0.416666 / 100
    units_at = 6 * mw_first / per_unit
    for factor, positive in [(0.5, False), (1.0, False), (2.0, True)]:
        amount = units_at * factor * 1974.0
        r = S.run(renda(amount=amount, horizon_years=30))
        e = r.events[0]
        assert e["date"] == "2030-01-15"
        expected = 0.001 * max(0.0, e["cash"] - 6 * mw_first)
        assert e["custody"] == pytest.approx(expected, abs=1e-6)
        assert (e["custody"] > 1e-9) is positive
