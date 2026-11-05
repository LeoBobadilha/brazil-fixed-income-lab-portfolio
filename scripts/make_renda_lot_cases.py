"""Independent reference cases for lot-aware income tax on Renda+ instalments.

Every expected value is plain arithmetic written in this file; nothing is imported
from src.pricing or the web engine. Each case gives explicit purchase lots (units,
nominal cost, settlement date) and one instalment (payment date, % of VNA, VNA on
that date), so the results can be checked by hand.

Rules applied (sources in config/assumptions/br_costs_taxes_v2026-11.json):
- Income tax: regressive table by holding period - up to 180 days 22.5%, 181-360
  days 20%, 361-720 days 17.5%, more than 720 days 15% (Lei 11.033/2004, art. 1).
- Holding period of each lot: calendar days from that lot's SETTLEMENT date to the
  payment date (RFB Nota Cosit 144/2018, published by STN/B3 in communication
  070/2018; Tesouro Direto rules section 14: coupons use the time since purchase).
- Taxable base of a lot: its share of the payment minus the share of its purchase
  cost returned by that instalment, cost x (instalment % / 100). This pro rata cost
  return is a modelling assumption; official pages do not state the allocation.
- IOF does not apply to instalments (Tesouro Direto rules section 14). A lot that
  settled less than 30 days before a payment is outside the model (engine raises).
- B3 custody on Renda+ income: 0.10% of the whole monthly payment above 6 minimum
  wages, per investor (not per lot).

    python scripts/make_renda_lot_cases.py   # writes tests/fixtures/renda_lot_cases.json
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "renda_lot_cases.json"
TA = 0.416666  # regular Renda+ instalment, % of VNA: trunc6(100/240)
TA_LAST = 0.416826  # final instalment: 100 - 239 x 0.416666
INCOME_RATE = 0.001  # 0.10% of the excess over the threshold


def bracket(age_days: int) -> float:
    if age_days <= 180:
        return 0.225
    if age_days <= 360:
        return 0.20
    if age_days <= 720:
        return 0.175
    return 0.15


def case(cid: str, note: str, pay_day: date, pct: float, vna: float, lots: list[dict], threshold: float) -> dict:
    out_lots, gross, cost, tax, gain_total = [], 0.0, 0.0, 0.0, 0.0
    for lot in lots:
        settle = date.fromisoformat(lot["settle"])
        age = (pay_day - settle).days
        pay = lot["units"] * vna * pct / 100
        c = lot["cost_nominal"] * pct / 100
        gain = max(0.0, pay - c)
        rate = bracket(age)
        out_lots.append({**lot, "age_days": age, "rate": rate, "payment": pay, "cost_returned": c, "income_tax": rate * gain})
        gross += pay
        cost += c
        tax += rate * gain
        gain_total += gain
    custody = INCOME_RATE * max(0.0, gross - threshold)
    return {
        "id": cid, "note": note,
        "input": {"pay_day": str(pay_day), "instalment_pct": pct, "vna_nominal": vna, "threshold_nominal": threshold,
                  "lots": [{k: v for k, v in x.items()} for x in lots]},
        "expected": {"gross": gross, "cost_returned": cost, "income_tax": tax, "custody": custody,
                     "net": gross - tax - custody, "effective_tax_rate": tax / gain_total if gain_total else 0.0,
                     "min_age_days": min(x["age_days"] for x in out_lots), "lots": out_lots},
    }


def settle_for_age(pay_day: date, age: int) -> str:
    return str(pay_day - timedelta(days=age))


cases = []
P2030 = date(2030, 1, 15)  # first instalment of Renda+ 2030
P2065 = date(2065, 1, 15)  # first instalment of Renda+ 2065
HIGH = 1e12  # threshold far above any payment: no custody

# L1 - one lot bought more than two years before the first payment -> 15%.
# 10 units bought 30/10/2026 at R$ 1,974.00 (settled 03/11/2026). VNA R$ 5,000 on the payment date.
# payment = 10 x 5000 x 0.416666% = 208.333; cost returned = 19740 x 0.416666% = 82.2499; tax = 15% of the difference.
cases.append(case("L1_single_lot_over_two_years", "Settled 03/11/2026, paid 15/01/2030: 1169 days -> 15%.",
                  P2030, TA, 5000.0, [{"settle": "2026-11-03", "units": 10.0, "cost_nominal": 19740.0}], HIGH))

# L2 - a contribution shortly before conversion: traded Friday 30/11/2029, settled
# Monday 03/12/2029 (D+1), 43 days before the first payment -> 22.5%.
cases.append(case("L2_contribution_shortly_before_conversion", "Settled 03/12/2029, paid 15/01/2030: 43 days -> 22.5%.",
                  P2030, TA, 5000.0, [{"settle": "2029-12-03", "units": 2.0, "cost_nominal": 9000.0}], HIGH))

# L3 - lots spanning the four brackets on one payment (ages 100, 300, 500 and 900 days).
cases.append(case("L3_lots_spanning_all_brackets", "Four lots aged 100/300/500/900 days -> 22.5/20/17.5/15%.", P2030, TA, 5000.0, [
    {"settle": settle_for_age(P2030, 100), "units": 1.0, "cost_nominal": 4500.0},
    {"settle": settle_for_age(P2030, 300), "units": 1.5, "cost_nominal": 6300.0},
    {"settle": settle_for_age(P2030, 500), "units": 2.0, "cost_nominal": 8000.0},
    {"settle": settle_for_age(P2030, 900), "units": 4.0, "cost_nominal": 14000.0},
], HIGH))

# L4 - bracket boundaries: 180 days is still 22.5%, 181 is 20%; 360 is 20%, 361 is 17.5%;
# 720 is 17.5%, 721 is 15%. Equal lots so each lot's tax differs only by its rate.
cases.append(case("L4_bracket_boundaries", "Ages 180/181/360/361/720/721 days.", P2030, TA, 5000.0, [
    {"settle": settle_for_age(P2030, d), "units": 1.0, "cost_nominal": 4000.0} for d in (180, 181, 360, 361, 720, 721)
], HIGH))

# L5 - allocation across lots with different costs: the same instalment returns a
# different cost share per lot, so a lot bought expensively has a smaller taxable gain.
cases.append(case("L5_cost_allocation_across_lots", "Same age, different costs: tax follows each lot's own gain.", P2030, TA, 5000.0, [
    {"settle": "2027-01-04", "units": 3.0, "cost_nominal": 3000.0},
    {"settle": "2027-01-04", "units": 3.0, "cost_nominal": 13000.0},
    {"settle": "2027-01-04", "units": 3.0, "cost_nominal": 15400.0},  # cost share 64.17 > payment 62.50: no gain, no tax
], HIGH))

# L6 - Renda+ 2065 first instalment with long-held and recent lots, VNA R$ 25,000 in 2065.
cases.append(case("L6_renda_2065_mixed_lots", "Renda+ 2065: lots aged 13,000 days and 70 days.", P2065, TA, 25000.0, [
    {"settle": settle_for_age(P2065, 13000), "units": 50.0, "cost_nominal": 9000.0},
    {"settle": settle_for_age(P2065, 70), "units": 1.0, "cost_nominal": 24000.0},
], HIGH))

# L7 - final instalment (0.416826%) of Renda+ 2030 on 15/12/2049, all lots old -> 15%.
cases.append(case("L7_final_instalment", "Final instalment uses 0.416826%.", date(2049, 12, 15), TA_LAST, 9000.0,
                  [{"settle": "2026-11-03", "units": 10.0, "cost_nominal": 19740.0}], HIGH))

# L8/L9 - custody threshold: 6 minimum wages = 6 x 1621 = 9726 (nominal, 2026 wage) used here
# as the threshold on the payment date. 100 units x 5000 x 0.416666% = 2083.33 is below it;
# 600 units -> 12,499.98 is above it, so custody = 0.1% x (12499.98 - 9726).
cases.append(case("L8_custody_below_threshold", "Payment below 6 minimum wages: no custody.", P2030, TA, 5000.0,
                  [{"settle": "2026-11-03", "units": 100.0, "cost_nominal": 197400.0}], 9726.0))
cases.append(case("L9_custody_above_threshold", "Payment above 6 minimum wages: 0.10% of the excess.", P2030, TA, 5000.0,
                  [{"settle": "2026-11-03", "units": 600.0, "cost_nominal": 1184400.0}], 9726.0))

# Out of scope: a lot settled 29 days before a payment (IOF territory) must be rejected.
guards = [{"id": "G1_lot_within_30_days_rejected", "pay_day": str(P2030), "settle": settle_for_age(P2030, 29)}]

OUT.write_text(json.dumps({"_source": "scripts/make_renda_lot_cases.py - independent hand arithmetic", "cases": cases,
                           "guards": guards}, indent=1), encoding="utf-8")
for c in cases:
    e = c["expected"]
    print(f"{c['id']}: gross {e['gross']:.4f} tax {e['income_tax']:.4f} custody {e['custody']:.4f} effective {e['effective_tax_rate']:.4%}")
