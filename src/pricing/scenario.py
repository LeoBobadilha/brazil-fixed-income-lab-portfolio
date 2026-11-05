"""Hypothetical holding-period scenarios (reference implementation).

The browser simulator (web/src/engine/scenario.ts) implements the same
algorithm; scripts/export_golden_vectors.py exports cases that the TypeScript
test suite must reproduce, and tests/test_reference_cases.py checks both
against independently hand-computed fixtures.

A scenario is NOT a forecast. Every input is an explicit assumption:
    entry  : observed purchase price/rate on the valuation date
    exit   : current sell rate + user-defined shock (bp), at the horizon date
    VNA    : grows with the assumed IPCA (calendar time) or Selic (du/252)
    flows  : coupons / amortisations before the horizon are reinvested at an
             assumed rate (du/252)
    costs  : B3 custody (accrued daily, collected at coupons, sale and
             maturity; NTN-B1 receipt and early-redemption rules), IOF and
             income tax per config/assumptions; each cost is computed once
             and listed separately
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from functools import lru_cache

import numpy as np
from dateutil.relativedelta import relativedelta

from src import calendar_br
from src.config import ASSUMPTIONS_DIR
from src.pricing.instruments import PRODUCTS, cashflow_schedule

DEFAULT_ASSUMPTIONS = "br_costs_taxes_v2026-11.json"


@lru_cache(maxsize=4)
def load_assumptions(name: str = DEFAULT_ASSUMPTIONS) -> dict:
    return json.loads((ASSUMPTIONS_DIR / name).read_text(encoding="utf-8"))


@dataclass
class ScenarioInput:
    product_code: str
    maturity: date
    valuation_date: date
    buy_price: float  # observed purchase PU on valuation date
    buy_rate: float  # % p.a.
    sell_rate: float  # observed sell rate on valuation date (% p.a.)
    vna0: float | None  # VNA on valuation date (None for LTN/NTN-F)
    amount: float = 10_000.0
    horizon_years: float = 3.0
    shock_bp: float = 0.0
    inflation_pa: float = 4.0  # % p.a., IPCA-linked products and minimum-wage path
    selic_pa: float = 12.0  # % p.a., LFT
    reinvest_pa: float = 12.0  # % p.a., intermediate flows
    apply_costs: bool = True
    apply_taxes: bool = True
    custody_deductible: bool | None = None
    assumptions: str = DEFAULT_ASSUMPTIONS


@dataclass
class ScenarioResult:
    horizon_date: str
    held_to_maturity: bool
    units: float
    exit_rate: float | None
    exit_price: float | None
    sale_proceeds: float
    flows_received: float
    flows_reinvested_value: float
    gross_value: float
    gross_return_pct: float
    gross_return_pa_pct: float
    custody: float
    iof: float
    income_tax: float
    net_value: float
    net_return_pct: float
    net_return_pa_pct: float
    real_net_return_pa_pct: float | None
    immediate_spread_cost: float
    custody_at_sale: float = 0.0
    custody_deductible: bool = False
    purchase_settlement: str = ""  # D+1 settlement of the purchase: start of the tax and custody clock
    tax_holding_days: int = 0  # purchase settlement to sale settlement (or to maturity when held)
    events: list[dict] = field(default_factory=list)


def _years_cal(d0: date, d1: date) -> float:
    return (d1 - d0).days / 365.25


def _du(d0, d1, asof=None) -> int:
    return int(calendar_br.business_days(np.datetime64(d0, "D"), np.datetime64(d1, "D"), asof=asof))


def horizon_date(d0: date, years: float, maturity: date) -> tuple[date, bool]:
    d1 = d0 + timedelta(days=round(years * 365.25))
    if d1 >= maturity:
        return maturity, True
    return calendar_br.to_date(calendar_br.add_business_days(d1, 0)), False


def vna_at(code: str, vna0: float | None, d0: date, d1: date, inflation_pa: float, selic_pa: float) -> float:
    if code in ("LTN", "NTNF"):
        return 1.0
    if code == "LFT":
        return vna0 * (1 + selic_pa / 100) ** (_du(d0, d1) / 252)
    return vna0 * (1 + inflation_pa / 100) ** _years_cal(d0, d1)


def model_price_at(code: str, maturity: date, d: date, rate_pct: float, vna: float) -> float:
    """Unrounded ex-flow price per unit at ``d`` (flows on or before ``d`` excluded).

    ``du`` uses the holiday calendar in force on ``d`` (see calendar_br), so a
    scenario starting on a historical date reproduces that date's conventions.
    """
    sched = cashflow_schedule(PRODUCTS[code], maturity)
    pv = 0.0
    for fd, amt, _ in sched:
        if fd <= d:
            continue
        du = _du(d, fd, asof=d)
        if du <= 0:
            continue
        pv += amt * (1 + rate_pct / 100) ** (-du / 252)
    return pv if code in ("LTN", "NTNF") else vna * pv / 100.0


# Tesouro Direto sales settle D+0 from this date (D+1 before); purchases settle D+1.
SELL_D0_FROM = date(2021, 9, 13)


def purchase_settlement(trade: date) -> date:
    """Settlement date of a Tesouro Direto purchase made on ``trade`` (D+1)."""
    return calendar_br.to_date(calendar_br.settlement_date(trade, 1))


def sale_settlement(trade: date) -> date:
    """Settlement date of a Tesouro Direto sale made on ``trade`` (D+0 since 13/09/2021)."""
    return trade if trade >= SELL_D0_FROM else calendar_br.to_date(calendar_br.settlement_date(trade, 1))


def ir_rate(days: int, a: dict) -> float:
    for row in a["income_tax"]["regressive_table"]:
        if row["max_days"] is None or days <= row["max_days"]:
            return row["rate"]
    return a["income_tax"]["regressive_table"][-1]["rate"]


def iof_share(days: int, a: dict) -> float:
    if days >= a["iof"]["applies_if_days_below"] or days < 1:
        return 0.0
    return a["iof"]["share_of_gain_by_day"][days - 1]


def accrue(points: list[tuple[date, float]], rate_pa: float) -> float:
    """Trapezoidal integral of ``rate_pa x max(base, 0)`` over actual/365 time."""
    total = 0.0
    for (t0, b0), (t1, b1) in zip(points, points[1:]):
        total += rate_pa * (max(b0, 0.0) + max(b1, 0.0)) / 2 * (t1 - t0).days / 365.0
    return total


def accrual_grid(d_from: date, d_to: date, step_months: int = 3) -> list[date]:
    """d_from, every ``step_months`` after it, and d_to."""
    out, k = [d_from], 1
    while True:
        t = d_from + relativedelta(months=step_months * k)
        if t >= d_to:
            break
        out.append(t)
        k += 1
    out.append(d_to)
    return out


def ntnb1_early_rate(tiers: list[dict], years: float) -> float:
    """Official Renda+/Educa+ early-redemption custody rate for the holding period."""
    for t in tiers:
        if t["max_years"] is None or years < t["max_years"]:
            return t["rate_pa"]
    return tiers[-1]["rate_pa"]


def run(inp: ScenarioInput) -> ScenarioResult:
    a = load_assumptions(inp.assumptions)
    code, d0 = inp.product_code, inp.valuation_date
    p = PRODUCTS[code]
    nominal = code in ("LTN", "NTNF")
    custody_deductible = (a["income_tax"]["custody_deductible_from_tax_base"]
                          if inp.custody_deductible is None else inp.custody_deductible)
    units = inp.amount / inp.buy_price
    d1, held = horizon_date(d0, inp.horizon_years, inp.maturity)
    # Holding periods for income tax and IOF are counted between the settlement dates
    # of the purchase and of the sale (RFB Nota Cosit 144/2018, STN/B3 communication
    # 070/2018). Coupons and instalments are counted from the purchase settlement to
    # the payment date. B3 custody also accrues from settlement (D+1).
    settle_buy = purchase_settlement(d0)
    settle_sell = d1 if held else sale_settlement(d1)
    days_total = max(0, (settle_sell - settle_buy).days)
    exit_rate = None if held else inp.sell_rate + inp.shock_bp / 100.0

    # Immediate round-trip cost implied by the buy/sell rate difference (information only)
    vna_now = inp.vna0 if inp.vna0 else 1.0
    sell_now = model_price_at(code, inp.maturity, d0, inp.sell_rate, vna_now)
    buy_now = model_price_at(code, inp.maturity, d0, inp.buy_rate, vna_now)
    spread_cost = units * max(0.0, buy_now - sell_now)

    sched = cashflow_schedule(p, inp.maturity)
    live = [(fd, amt, kind) for fd, amt, kind in sched if d0 < fd <= d1]
    flow_on: dict[date, float] = {}
    for fd, amt, _ in live:
        flow_on[fd] = flow_on.get(fd, 0.0) + amt

    def vna_t(t: date) -> float:
        return vna_at(code, inp.vna0, d0, t, inp.inflation_pa, inp.selic_pa)

    def cash_per_unit(amt: float, t: date) -> float:
        return amt if nominal else vna_t(t) * amt / 100.0

    # Custody base: modelled position value along a linear yield path from the
    # purchase rate to the exit rate (flat at the purchase rate when held).
    y_end = inp.buy_rate if held else exit_rate
    span = max((d1 - d0).days, 1)

    def position_value(t: date, cum_flow: bool) -> float:
        """Position value on ``t``; ``cum_flow`` includes a payment due on ``t``.

        A collection period starts ex-payment (the coupon just paid no longer
        earns custody) and ends cum-payment (the position before it pays out).
        """
        y = inp.buy_rate + (y_end - inp.buy_rate) * (t - d0).days / span
        v = model_price_at(code, inp.maturity, t, y, vna_t(t))
        if cum_flow and t in flow_on:
            v += cash_per_unit(flow_on[t], t)
        return units * v

    standard_custody = inp.apply_costs and not p.n_amort
    exempt = a["custody"]["selic_exempt_amount_brl"] if code == "LFT" else 0.0
    rate_b3 = a["custody"]["b3_rate_pa"]
    last_collection = [settle_buy]

    def collect(t: date) -> float:
        """Custody accrued since the previous collection, deducted on ``t``."""
        if not standard_custody or t <= last_collection[0]:
            return 0.0
        grid = accrual_grid(last_collection[0], t)
        pts = [(g, position_value(g, cum_flow=(g == t)) - exempt) for g in grid]
        last_collection[0] = t
        return accrue(pts, rate_b3)

    rules = a["custody"]["renda_plus" if code == "RENDA" else "educa_plus"] if p.n_amort else None
    mw0 = a["custody"]["minimum_wage_brl"]

    def min_wage(t: date) -> float:
        return mw0 * (1 + inp.inflation_pa / 100) ** _years_cal(d0, t)

    remaining_principal = sum(amt for fd, amt, _ in sched if fd > d0) if p.n_amort else None
    events: list[dict] = []
    flows_received = flows_fv = tax_flows = custody_flows = flows_gross_fv = cost_used = 0.0
    for fd, amt, kind in live:
        cash = units * cash_per_unit(amt, fd)
        if p.n_amort:  # NTN-B1: each instalment returns principal pro rata
            cost_part = inp.amount * amt / remaining_principal
        elif "principal" in kind:
            cost_part = inp.amount
        else:
            cost_part = 0.0
        cost_used += cost_part
        gain = cash - cost_part
        if p.n_amort:
            threshold = rules["income_threshold_minimum_wages"] * min_wage(fd)
            cust = rules["income_rate"] * max(0.0, cash - threshold) if inp.apply_costs else 0.0
        else:
            cust = collect(fd)  # accrued custody deducted from the coupon / maturity payment
        taxable = max(0.0, gain - (cust if custody_deductible else 0.0))
        tax = ir_rate(max(0, (fd - settle_buy).days), a) * taxable if inp.apply_taxes else 0.0
        net_cash = cash - cust - tax
        growth = (1 + inp.reinvest_pa / 100) ** (_du(fd, d1) / 252)
        flows_gross_fv += cash * growth
        flows_received += cash
        flows_fv += net_cash * growth
        tax_flows += tax
        custody_flows += cust
        events.append({"date": str(fd), "kind": kind, "cash": cash, "custody": cust, "income_tax": tax,
                       "value_at_horizon": net_cash * growth})

    sale, exit_price = 0.0, None
    custody_sale = iof = tax_sale = 0.0
    if not held:
        exit_price = model_price_at(code, inp.maturity, d1, exit_rate, vna_t(d1))
        sale = units * exit_price
        cost_left = inp.amount - cost_used
        if inp.apply_costs:
            if p.n_amort:
                yrs_held = days_total / 365.0
                custody_sale = ntnb1_early_rate(rules["early_redemption_tiers"], yrs_held) * yrs_held * sale
            else:
                custody_sale = collect(d1)
        gain = sale - cost_left - (custody_sale if custody_deductible else 0.0)
        if inp.apply_taxes and gain > 0:
            iof = iof_share(days_total, a) * gain
            tax_sale = ir_rate(days_total, a) * (gain - iof)

    gross = sale + flows_gross_fv
    custody = custody_flows + custody_sale
    income_tax = tax_flows + tax_sale
    net = sale - custody_sale - iof - tax_sale + flows_fv
    yrs = max(_years_cal(d0, d1), 1e-9)

    def ann(v):
        return ((v / inp.amount) ** (1 / yrs) - 1) * 100 if v > 0 else -100.0

    real = None
    if p.indexer == "ipca":
        real = ((1 + ann(net) / 100) / (1 + inp.inflation_pa / 100) - 1) * 100
    return ScenarioResult(
        horizon_date=str(d1), held_to_maturity=held, units=units, exit_rate=exit_rate, exit_price=exit_price,
        sale_proceeds=sale, flows_received=flows_received, flows_reinvested_value=flows_fv, gross_value=gross,
        gross_return_pct=(gross / inp.amount - 1) * 100, gross_return_pa_pct=ann(gross), custody=custody, iof=iof,
        income_tax=income_tax, net_value=net, net_return_pct=(net / inp.amount - 1) * 100, net_return_pa_pct=ann(net),
        real_net_return_pa_pct=real, immediate_spread_cost=spread_cost, custody_at_sale=custody_sale,
        custody_deductible=custody_deductible, purchase_settlement=str(settle_buy), tax_holding_days=days_total,
        events=events,
    )


def instant_shock(code: str, maturity: date, d0: date, rate_pct: float, shock_bp: float, vna: float | None) -> dict:
    """Theoretical immediate repricing vs duration / duration+convexity approximations."""
    from src.pricing.engine import risk

    v = vna or 1.0
    p0 = model_price_at(code, maturity, d0, rate_pct, v)
    p1 = model_price_at(code, maturity, d0, rate_pct + shock_bp / 100, v)
    r = risk(code, maturity, d0, rate_pct)
    dy = shock_bp / 1e4
    return {"exact_pct": (p1 / p0 - 1) * 100, "duration_pct": -r.modified * dy * 100,
            "duration_convexity_pct": (-r.modified * dy + 0.5 * r.convexity * dy * dy) * 100, "modified": r.modified,
            "convexity": r.convexity}


def as_dict(r: ScenarioResult) -> dict:
    return asdict(r)
