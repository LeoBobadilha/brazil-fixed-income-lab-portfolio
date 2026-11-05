"""Generate independent, hand-checkable reference cases for the cost/tax layer.

Every expected value below is computed with plain arithmetic written out in
this file - no import from src.pricing. Inputs are chosen so the custody base is
piecewise constant (zero yields, zero inflation/Selic), which makes the official
"0.20% p.a., provisioned daily, pro rata" rule an exact product rather than an
integral. Dates are written as literals; business-day rolls are explained
inline. Output: tests/fixtures/reference_cases.json (frozen; regenerate only if
an official rule changes, never to make code pass).

Sprint 8 rule correction: income-tax and IOF holding periods are counted between
the SETTLEMENT dates of the purchase and of the sale (RFB Nota Cosit 144/2018,
published by STN and B3 in communication 070/2018), and B3 custody accrues from
settlement (D+1). Purchases settle D+1 and sales D+0 (since 13/09/2021). The
inputs are unchanged; the clocks below now start at the purchase settlement S0.

    python scripts/make_reference_cases.py
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "reference_cases.json"
D0 = date(2026, 10, 30)  # Friday: trade date of every purchase below
# Purchase settlement D+1: Saturday 31/10 and Sunday 01/11 are not business days and
# Monday 02/11/2026 is Finados (national holiday), so the purchase settles Tuesday 03/11.
S0 = date(2026, 11, 3)
CUSTODY = 0.002
TA = 0.416666  # trunc6(100/240)
NTNB_COUPON = 2.956301  # round6((1.06^0.5 - 1) * 100)


def days(a: date, b: date) -> int:
    return (b - a).days


cases = []

# R1 - Tesouro Selic, zero spread and zero Selic: the price stays equal to the VNA,
# so the position value is constant. Horizon 1y: 30/10/2026 + 365 days = 30/10/2027
# (Saturday) -> next business day Monday 01/11/2027 (02/11 Finados is a Tuesday).
amount, vna0 = 50_000.0, 20_000.0
d1 = date(2027, 11, 1)
n = days(S0, d1)  # custody from purchase settlement to the sale (settles D+0)
custody = CUSTODY * (amount - 10_000.0) * n / 365  # fee only on the excess over R$ 10,000
cases.append({
    "id": "R1_selic_exemption_constant_value",
    "input": {"product_code": "LFT", "maturity": "2031-03-01", "valuation_date": str(D0), "buy_price": vna0, "buy_rate": 0.0,
              "sell_rate": 0.0, "vna0": vna0, "amount": amount, "horizon_years": 1.0, "shock_bp": 0.0, "inflation_pa": 0.0,
              "selic_pa": 0.0, "reinvest_pa": 0.0, "apply_costs": True, "apply_taxes": True},
    "expected": {"horizon_date": str(d1), "sale_proceeds": amount, "custody": custody, "income_tax": 0.0, "iof": 0.0,
                 "net_value": amount - custody, "purchase_settlement": str(S0), "tax_holding_days": n},
    "formula": f"custody = 0.002 x (50000 - 10000) x {n}/365; sale = units x VNA = amount (zero spread, zero Selic); gain 0 -> no tax",
})

# R2 - IPCA+ with semiannual coupons, zero real yield and zero inflation. Before each
# payment the value per unit is VNA x (sum of remaining flows incl. the one due)/100,
# constant between payments. First coupon 15/11/2026 (16 days), second 15/05/2027.
maturity = date(2035, 5, 15)
vna0, price = 4800.0, None
remaining_flows = 18 * NTNB_COUPON + 100.0  # coupons 15/11/2026 ... 15/05/2035 (18 dates) + principal
price = vna0 * remaining_flows / 100.0  # buy price at zero yield
amount = 100_000.0
units = amount / price
c1, c2 = date(2026, 11, 15), date(2027, 5, 15)
value_before_c1 = units * vna0 * remaining_flows / 100.0  # = amount
cust_c1 = CUSTODY * value_before_c1 * days(S0, c1) / 365  # 12 days from settlement
value_before_c2 = units * vna0 * (remaining_flows - NTNB_COUPON) / 100.0
cust_c2 = CUSTODY * value_before_c2 * days(c1, c2) / 365
coupon_cash = units * vna0 * NTNB_COUPON / 100.0
tax_c1 = 0.225 * coupon_cash  # 12 days after settlement -> 22.5% bracket; IOF never applies to coupons
tax_c2 = 0.20 * coupon_cash  # 193 days after settlement -> 20% bracket
cases.append({
    "id": "R2_ntnb_custody_and_tax_at_coupons",
    "input": {"product_code": "NTNB", "maturity": str(maturity), "valuation_date": str(D0), "buy_price": price, "buy_rate": 0.0,
              "sell_rate": 0.0, "vna0": vna0, "amount": amount, "horizon_years": 9.0, "shock_bp": 0.0, "inflation_pa": 0.0,
              "selic_pa": 0.0, "reinvest_pa": 0.0, "apply_costs": True, "apply_taxes": True},
    "expected_events": [
        {"date": str(c1), "cash": coupon_cash, "custody": cust_c1, "income_tax": tax_c1},
        {"date": str(c2), "cash": coupon_cash, "custody": cust_c2, "income_tax": tax_c2},
    ],
    "formula": "custody_k = 0.002 x value_before_payment x days_since_previous_collection/365; tax_k = bracket(days since purchase) x coupon (custody not deducted from the IR base by default)",
})

# R3 - Renda+ 2030 instalments with 4% IPCA. Cash = units x VNA0 x 1.04^(days/365.25) x Ta/100.
# Cost returned pro rata: amount x Ta/100 (all 240 instalments remain); IR 15% (> 720 days).
amount, vna0, buy_price = 10_000.0, 4771.18, 1974.0
units = amount / buy_price
first = date(2030, 1, 15)
infl = 1.04 ** (days(D0, first) / 365.25)
cash1 = units * vna0 * infl * TA / 100
cost1 = amount * TA / 100
tax1 = 0.15 * (cash1 - cost1)
mw_first = 1621.0 * infl
cases.append({
    "id": "R3_renda_first_instalment",
    "input": {"product_code": "RENDA", "maturity": "2049-12-15", "valuation_date": str(D0), "buy_price": buy_price, "buy_rate": 7.5,
              "sell_rate": 7.62, "vna0": vna0, "amount": amount, "horizon_years": 30.0, "shock_bp": 0.0, "inflation_pa": 4.0,
              "selic_pa": 12.0, "reinvest_pa": 0.0, "apply_costs": True, "apply_taxes": True},
    "expected_events": [{"date": str(first), "cash": cash1, "custody": 0.001 * max(0.0, cash1 - 6 * mw_first), "income_tax": tax1}],
    "formula": "cash = units x 4771.18 x 1.04^(days/365.25) x 0.416666/100; tax = 15% x (cash - 10000 x 0.416666/100); custody = 0.1% of the excess over 6 x 1621 x 1.04^(days/365.25)",
})

# R4 - Renda+ 2065 sold after ~5 years, zero real yield and zero inflation: the unit
# price equals VNA0 x (sum of the 240 instalments = 100)/100 = VNA0. Early-redemption
# custody = 0.50% p.a. (holding < 10 years) x years x value sold.
# Horizon: 30/10/2026 + round(5 x 365.25) = 1826 days -> 30/10/2031 (Thursday).
# Years held: purchase settlement 03/11/2026 to sale settlement 30/10/2031 (D+0).
vna0, amount = 4800.0, 10_000.0
units = amount / vna0
d1 = date(2031, 10, 30)
yrs = days(S0, d1) / 365.0
sale = units * vna0
cases.append({
    "id": "R4_renda_early_redemption_tier",
    "input": {"product_code": "RENDA", "maturity": "2084-12-15", "valuation_date": str(D0), "buy_price": vna0, "buy_rate": 0.0,
              "sell_rate": 0.0, "vna0": vna0, "amount": amount, "horizon_years": 5.0, "shock_bp": 0.0, "inflation_pa": 0.0,
              "selic_pa": 0.0, "reinvest_pa": 0.0, "apply_costs": True, "apply_taxes": True},
    "expected": {"horizon_date": str(d1), "sale_proceeds": sale, "custody": 0.005 * yrs * sale, "income_tax": 0.0, "iof": 0.0,
                 "net_value": sale - 0.005 * yrs * sale},
    "formula": f"sale = units x VNA0 = 10000; custody = 0.005 x {days(S0, d1)}/365 x 10000; gain 0 -> no tax",
})

# R5 - Prefixado bought at R$ 990 and sold 10 calendar days later at a zero yield (price 1000).
# Horizon: round(10/365.25 x 365.25) = 10 days -> 09/11/2026 (Monday), sale settles D+0.
# Holding period between settlements: 03/11/2026 -> 09/11/2026 = 6 days, so
# IOF day 6 = 80% of the gain (Decreto 6.306/2007 table), then IR 22.5% on (gain - IOF).
amount, buy_price = 10_000.0, 990.0
units = amount / buy_price
d1 = date(2026, 11, 9)
sale = units * 1000.0
gain = sale - amount
custody = CUSTODY * sale * days(S0, d1) / 365  # constant value units x 1000 at zero yield, from settlement
iof = 0.80 * gain
tax = 0.225 * (gain - iof)
cases.append({
    "id": "R5_ltn_iof_short_sale",
    "input": {"product_code": "LTN", "maturity": "2032-01-01", "valuation_date": str(D0), "buy_price": buy_price, "buy_rate": 0.0,
              "sell_rate": 0.0, "vna0": None, "amount": amount, "horizon_years": 10 / 365.25, "shock_bp": 0.0, "inflation_pa": 0.0,
              "selic_pa": 0.0, "reinvest_pa": 0.0, "apply_costs": True, "apply_taxes": True},
    "expected": {"horizon_date": str(d1), "sale_proceeds": sale, "custody": custody, "iof": iof, "income_tax": tax,
                 "net_value": sale - custody - iof - tax, "purchase_settlement": str(S0), "tax_holding_days": days(S0, d1)},
    "formula": "IOF = 80% x gain (6 days between settlements); IR = 22.5% x (gain - IOF); custody = 0.002 x units x 1000 x 6/365 (not deducted from the IR base)",
})

OUT.write_text(json.dumps({"_source": "scripts/make_reference_cases.py - independent hand arithmetic; see formulas", "cases": cases}, indent=1),
               encoding="utf-8")
for c in cases:
    print(c["id"], json.dumps(c.get("expected") or c.get("expected_events"))[:160])
